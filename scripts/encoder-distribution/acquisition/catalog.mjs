import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
    exactKeys,
    fail,
    SHA256,
    validRelative,
} from '../schema.mjs';

export const CATALOG_FILE = fileURLToPath(new URL(
    '../../../src-tauri/encoder-distribution/jellyfin-ffmpeg-v7.1.4-3.json',
    import.meta.url,
));

const RUST_HOSTS = {
    'darwin:arm64': 'aarch64-apple-darwin',
    'darwin:x64': 'x86_64-apple-darwin',
    'win32:x64': 'x86_64-pc-windows-msvc',
};

const isHttps = (value) => {
    try {
        return new URL(value).protocol === 'https:';
    } catch {
        return false;
    }
};

const validatePinnedFile = (value, label) => {
    if (!SHA256.test(value.sha256)
        || !Number.isSafeInteger(value.size_bytes)
        || value.size_bytes <= 0) {
        fail(`${label} requires a positive size and SHA-256`);
    }
};

const validateTarget = (value, target) => {
    exactKeys(
        value,
        [
            'distribution_target',
            'asset',
            'sha256',
            'size_bytes',
            'archive_type',
            'ffmpeg_member',
            'ffprobe_member',
        ],
        `catalog.targets.${target}`,
    );
    validatePinnedFile(value, `catalog.targets.${target}`);
    if (!validRelative(value.asset, true)
        || !validRelative(value.ffmpeg_member)
        || !validRelative(value.ffprobe_member)) {
        fail(`Catalog target ${target} contains an unsafe archive path`);
    }
    const windows = target === 'x86_64-pc-windows-msvc';
    const expectedDistribution = {
        'aarch64-apple-darwin': 'macos-aarch64',
        'x86_64-apple-darwin': 'macos-x86_64',
        'x86_64-pc-windows-msvc': 'windows-x86_64',
    }[target];
    if (!expectedDistribution || value.distribution_target !== expectedDistribution) {
        fail(`Catalog target mapping is invalid for ${target}`);
    }
    if (value.archive_type !== (windows ? 'zip' : 'tar.xz')) {
        fail(`Catalog archive type is invalid for ${target}`);
    }
};

export const validateReleaseCatalog = (catalog) => {
    exactKeys(catalog, ['schema_version', 'release', 'distribution', 'targets'], 'catalog');
    if (catalog.schema_version !== 1) fail('catalog.schema_version must be 1');
    exactKeys(
        catalog.release,
        ['project', 'tag', 'ffmpeg_version', 'base_url', 'source'],
        'catalog.release',
    );
    exactKeys(
        catalog.release.source,
        ['url', 'sha256', 'size_bytes', 'license_files'],
        'catalog.release.source',
    );
    validatePinnedFile(catalog.release.source, 'catalog.release.source');
    if (!isHttps(catalog.release.base_url)
        || !catalog.release.base_url.endsWith('/')
        || !isHttps(catalog.release.source.url)) {
        fail('Catalog release URLs are invalid');
    }
    const licenseFiles = catalog.release.source.license_files;
    if (!Array.isArray(licenseFiles) || licenseFiles.length === 0) {
        fail('Catalog source requires license files');
    }
    const licenseDestinations = new Set();
    for (const [index, entry] of licenseFiles.entries()) {
        exactKeys(entry, ['member', 'file'], `catalog.release.source.license_files[${index}]`);
        if (!validRelative(entry.member)
            || !validRelative(entry.file)
            || !entry.file.startsWith('licenses/')
            || licenseDestinations.has(entry.file)) {
            fail('Catalog source license paths must be safe and unique');
        }
        licenseDestinations.add(entry.file);
    }
    if (!licenseFiles.some(({ member, file }) => (
        member.endsWith('/COPYING.GPLv3') && file === 'licenses/COPYING.GPLv3'
    ))) {
        fail('Catalog source must stage the upstream COPYING.GPLv3 notice');
    }
    exactKeys(
        catalog.distribution,
        [
            'license_spdx',
            'redistribution_basis',
            'review_reference',
            'approval',
        ],
        'catalog.distribution',
    );
    exactKeys(
        catalog.distribution.approval,
        [
            'redistribution_approved',
            'approved_by',
            'approved_at',
            'review_reference',
            'signing_required',
        ],
        'catalog.distribution.approval',
    );
    if (catalog.distribution.license_spdx !== 'GPL-3.0-or-later'
        || catalog.distribution.approval.redistribution_approved !== true
        || catalog.distribution.approval.signing_required !== true) {
        fail('Catalog redistribution policy is not explicitly approved GPLv3');
    }
    const targets = Object.keys(catalog.targets).sort();
    const expected = Object.values(RUST_HOSTS).sort();
    if (JSON.stringify(targets) !== JSON.stringify(expected)) {
        fail(`Catalog target set must be exactly: ${expected.join(', ')}`);
    }
    targets.forEach((target) => validateTarget(catalog.targets[target], target));
    return catalog;
};

export const loadReleaseCatalog = async (file = CATALOG_FILE) => {
    try {
        return validateReleaseCatalog(JSON.parse(await readFile(file, 'utf8')));
    } catch (error) {
        if (error.name === 'DistributionError') throw error;
        fail(`Cannot load release catalog ${file}: ${error.message}`);
    }
};

export const hostRustTarget = ({ platform = process.platform, arch = process.arch } = {}) => (
    RUST_HOSTS[`${platform}:${arch}`] || null
);

export const resolveReleaseTarget = (
    catalog,
    requested,
    { environment = process.env, platform = process.platform, arch = process.arch } = {},
) => {
    const target = requested || environment.RAV_ENCODER_TARGET || hostRustTarget({ platform, arch });
    if (!target || !catalog.targets[target]) {
        fail(`Unsupported or missing production encoder target: ${target || '<none>'}`);
    }
    return { rustTarget: target, ...catalog.targets[target] };
};
