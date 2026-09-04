import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { inspectNativeBinary } from '../platform.mjs';
import { fail, hostTarget } from '../schema.mjs';

const execFile = promisify(execFileCallback);

const cStringAfter = (bytes, marker) => {
    const start = bytes.indexOf(Buffer.from(marker, 'utf8'));
    if (start < 0) return null;
    let end = start;
    const limit = Math.min(bytes.length, start + 64 * 1024);
    while (end < limit && bytes[end] !== 0 && bytes[end] !== 10 && bytes[end] !== 13) end += 1;
    return bytes.subarray(start, end).toString('utf8');
};

export const validateVersionText = (text, id, expectedVersion) => {
    const versionMarker = `${id} version ${expectedVersion}`;
    if (!text.includes(versionMarker)) {
        fail(`${id} does not identify itself as ${expectedVersion}`);
    }
    const configuration = text.split(/\r?\n/).find((line) => line.startsWith('configuration:'))
        || cStringAfter(Buffer.from(text), 'configuration:');
    if (!configuration
        || !configuration.includes('--enable-gpl')
        || !configuration.includes('--enable-version3')) {
        fail(`${id} is not an explicit GPL version3 build`);
    }
    if (configuration.includes('--enable-nonfree')) {
        fail(`${id} contains the forbidden --enable-nonfree configuration`);
    }
    return { version: expectedVersion, configuration };
};

export const inspectEmbeddedMetadata = async (file, id, expectedVersion) => {
    const bytes = await readFile(file);
    const version = cStringAfter(bytes, `version ${expectedVersion}`);
    const configuration = cStringAfter(bytes, 'configuration:');
    if (!version || !configuration) fail(`Cannot locate embedded ${id} release metadata`);
    return validateVersionText(`${id} ${version}\n${configuration}`, id, expectedVersion);
};

const executeVersion = async (file) => {
    try {
        return (await execFile(file, ['-version'], {
            encoding: 'utf8',
            maxBuffer: 256 * 1024,
            timeout: 30_000,
        })).stdout;
    } catch (error) {
        fail(`Cannot execute pinned encoder ${file}: ${error.message}`);
    }
};

export const signMacBinary = async (file, identity, runner = execFile) => {
    if (!identity) return false;
    if (typeof identity !== 'string' || identity.length > 256 || /[\r\n]/.test(identity)) {
        fail('macOS signing identity is invalid');
    }
    const args = ['--force', '--sign', identity, '--options', 'runtime'];
    if (identity !== '-') args.push('--timestamp');
    args.push(file);
    try {
        await runner('/usr/bin/codesign', args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    } catch (error) {
        fail(`Cannot sign encoder ${file}: ${error.message}`);
    }
    return true;
};

export const inspectReleaseBinary = async ({
    file,
    id,
    version,
    distributionTarget,
    inspectBinary = inspectNativeBinary,
    embeddedInspector = inspectEmbeddedMetadata,
    versionRunner = executeVersion,
    nativeTarget = hostTarget(),
}) => {
    await inspectBinary(file, distributionTarget);
    const metadata = await embeddedInspector(file, id, version);
    if (distributionTarget === nativeTarget) {
        validateVersionText(await versionRunner(file), id, version);
    }
    return metadata;
};
