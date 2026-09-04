import { constants as fsConstants } from 'node:fs';
import {
    chmod,
    copyFile,
    mkdir,
    readFile,
    writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquirePinnedFile } from './download.mjs';
import { prepareSourceTree } from './extract.mjs';
import { inspectReleaseBinary, signMacBinary } from './inspect.mjs';
import { loadReleaseCatalog, resolveReleaseTarget } from './catalog.mjs';
import { fileIntegrity } from '../integrity.mjs';
import { canonicalJson, fail, MAX_BINARY, MAX_DOCUMENT } from '../schema.mjs';
import { stageDistribution } from '../stage-lib.mjs';

const PROVENANCE_FILE = 'provenance/jellyfin-ffmpeg-v7.1.4-3.json';
const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const REPOSITORY_OUTPUT = path.join(
    REPOSITORY_ROOT,
    'src-tauri',
    'encoder-resources',
    'encoders',
);

const resolvedDirectory = (value, label) => {
    if (!value || !path.isAbsolute(value)) fail(`${label} must be an explicit absolute path`);
    return path.resolve(value);
};

const overlaps = (left, right) => left === right
    || left.startsWith(`${right}${path.sep}`)
    || right.startsWith(`${left}${path.sep}`);

const insideRepository = (directory) => directory === REPOSITORY_ROOT
    || directory.startsWith(`${REPOSITORY_ROOT}${path.sep}`);

const validateDirectories = (workDirectory, cacheDirectory, outputDirectory) => {
    const directories = [workDirectory, cacheDirectory, outputDirectory];
    if (insideRepository(workDirectory) || insideRepository(cacheDirectory)) {
        fail('Work and cache directories must remain outside tracked repository source');
    }
    if (insideRepository(outputDirectory) && outputDirectory !== REPOSITORY_OUTPUT) {
        fail(`The only repository output allowed is ${REPOSITORY_OUTPUT}`);
    }
    for (let left = 0; left < directories.length; left += 1) {
        for (let right = left + 1; right < directories.length; right += 1) {
            if (overlaps(directories[left], directories[right])) {
                fail('Work, cache, and output directories must not overlap');
            }
        }
    }
};

const createWorkDirectory = async (directory) => {
    await mkdir(path.dirname(directory), { recursive: true, mode: 0o755 });
    try {
        await mkdir(directory, { recursive: false, mode: 0o755 });
    } catch (error) {
        fail(`Work directory must not already exist: ${directory}: ${error.message}`);
    }
};

const assertGplV3 = (text) => {
    if (!text.includes('GNU GENERAL PUBLIC LICENSE')
        || !text.includes('Version 3, 29 June 2007')) {
        fail('Pinned source archive does not contain the expected GPLv3 notice');
    }
};

const copyLicense = async ({ source, file }, input) => {
    const text = await readFile(source, 'utf8');
    if (file.endsWith('COPYING.GPLv3')) assertGplV3(text);
    const destination = path.join(input, file);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
    await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
    await chmod(destination, 0o644);
    return fileIntegrity(destination, MAX_DOCUMENT);
};

const artifactUrl = (catalog, target) => new URL(target.asset, catalog.release.base_url).href;

const binaryInventory = ({
    id,
    relative,
    integrity,
    metadata,
    catalog,
    target,
    provenance,
    licenses,
}) => ({
    id,
    source_file: `bin/${relative}`,
    file: relative,
    sha256: integrity.sha256,
    size_bytes: integrity.size_bytes,
    version: metadata.version,
    source: {
        kind: 'upstream_release',
        artifact_url: artifactUrl(catalog, target),
        artifact_sha256: target.sha256,
        source_code_url: catalog.release.source.url,
        source_code_sha256: catalog.release.source.sha256,
    },
    provenance_file: {
        source_file: PROVENANCE_FILE,
        file: PROVENANCE_FILE,
        ...provenance,
    },
    license: {
        spdx: catalog.distribution.license_spdx,
        notice_files: licenses,
        redistribution_basis: catalog.distribution.redistribution_basis,
        review_reference: catalog.distribution.review_reference,
    },
});

const writeProvenance = async ({
    input,
    catalog,
    target,
    signingIdentity,
    binaries,
}) => {
    const file = path.join(input, PROVENANCE_FILE);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o755 });
    const document = {
        schema_version: 1,
        producer: 'RAV encoder-distribution acquisition v1',
        project: catalog.release.project,
        tag: catalog.release.tag,
        rust_target: target.rustTarget,
        distribution_target: target.distribution_target,
        artifact: {
            url: artifactUrl(catalog, target),
            sha256: target.sha256,
            size_bytes: target.size_bytes,
            archive_type: target.archive_type,
            members: [target.ffmpeg_member, target.ffprobe_member],
        },
        corresponding_source: catalog.release.source,
        required_configuration: ['--enable-gpl', '--enable-version3'],
        forbidden_configuration: ['--enable-nonfree'],
        signing: signingIdentity || 'upstream-signature-preserved',
        binaries,
    };
    await writeFile(file, canonicalJson(document), { mode: 0o644, flag: 'wx' });
    return fileIntegrity(file, MAX_DOCUMENT);
};

export const acquireDistribution = async ({
    target: requestedTarget,
    workDirectory: workInput,
    cacheDirectory: cacheInput,
    outputDirectory: outputInput,
    macSigningIdentity,
    catalogFile,
    downloader,
    archiveRunner,
    inspectBinary,
    embeddedInspector,
    versionRunner,
    signer = signMacBinary,
    platform = process.platform,
} = {}) => {
    const workDirectory = resolvedDirectory(workInput, 'Work directory');
    const cacheDirectory = resolvedDirectory(cacheInput, 'Cache directory');
    const outputDirectory = resolvedDirectory(outputInput, 'Output directory');
    validateDirectories(workDirectory, cacheDirectory, outputDirectory);
    const catalog = await loadReleaseCatalog(catalogFile);
    const target = resolveReleaseTarget(catalog, requestedTarget, { platform });
    if (macSigningIdentity && !target.rustTarget.endsWith('-apple-darwin')) {
        fail('--mac-signing-identity is valid only for a macOS target');
    }
    await createWorkDirectory(workDirectory);
    const sourceName = path.posix.basename(new URL(catalog.release.source.url).pathname);
    const [assetArchive, sourceArchive] = await Promise.all([
        acquirePinnedFile({
            url: artifactUrl(catalog, target),
            filename: target.asset,
            sha256: target.sha256,
            size_bytes: target.size_bytes,
            cacheDirectory,
            downloader,
        }),
        acquirePinnedFile({
            url: catalog.release.source.url,
            filename: sourceName,
            sha256: catalog.release.source.sha256,
            size_bytes: catalog.release.source.size_bytes,
            cacheDirectory,
            downloader,
        }),
    ]);
    const prepared = await prepareSourceTree({
        workDirectory,
        assetArchive,
        sourceArchive,
        target,
        source: catalog.release.source,
        platform,
        runner: archiveRunner,
    });
    if (macSigningIdentity) {
        await signer(prepared.ffmpeg, macSigningIdentity);
        await signer(prepared.ffprobe, macSigningIdentity);
    }
    const inspect = (file, id) => inspectReleaseBinary({
        file,
        id,
        version: catalog.release.ffmpeg_version,
        distributionTarget: target.distribution_target,
        inspectBinary,
        embeddedInspector,
        versionRunner,
    });
    const [ffmpegMetadata, ffprobeMetadata] = await Promise.all([
        inspect(prepared.ffmpeg, 'ffmpeg'),
        inspect(prepared.ffprobe, 'ffprobe'),
    ]);
    const [ffmpegIntegrity, ffprobeIntegrity] = await Promise.all([
        fileIntegrity(prepared.ffmpeg, MAX_BINARY),
        fileIntegrity(prepared.ffprobe, MAX_BINARY),
    ]);
    const licenses = await Promise.all(prepared.licenses.map(async (entry) => ({
        source_file: entry.file,
        file: entry.file,
        ...await copyLicense(entry, prepared.input),
    })));
    const provenance = await writeProvenance({
        input: prepared.input,
        catalog,
        target,
        signingIdentity: macSigningIdentity,
        binaries: {
            ffmpeg: { ...ffmpegIntegrity, configuration: ffmpegMetadata.configuration },
            ffprobe: { ...ffprobeIntegrity, configuration: ffprobeMetadata.configuration },
        },
    });
    const extension = target.distribution_target.startsWith('windows-') ? '.exe' : '';
    const inventory = {
        schema_version: 1,
        distribution: {
            id: `jellyfin-ffmpeg-${catalog.release.tag}-${target.rustTarget}`,
            target: target.distribution_target,
            provenance_summary: `Pinned ${catalog.release.project} ${catalog.release.tag} GPL portable release`,
            approval: catalog.distribution.approval,
        },
        binaries: [
            binaryInventory({
                id: 'ffmpeg', relative: `ffmpeg${extension}`, integrity: ffmpegIntegrity,
                metadata: ffmpegMetadata, catalog, target, provenance, licenses,
            }),
            binaryInventory({
                id: 'ffprobe', relative: `ffprobe${extension}`, integrity: ffprobeIntegrity,
                metadata: ffprobeMetadata, catalog, target, provenance, licenses,
            }),
        ],
    };
    const inventoryFile = path.join(workDirectory, 'inventory.json');
    await writeFile(inventoryFile, canonicalJson(inventory), { mode: 0o644, flag: 'wx' });
    const receipt = await stageDistribution({
        inventoryFile,
        sourceDirectory: prepared.input,
        outputDirectory,
        expectedTarget: target.distribution_target,
        inspectBinary,
    });
    return {
        ...receipt,
        rust_target: target.rustTarget,
        work_directory: workDirectory,
        cache_directory: cacheDirectory,
    };
};
