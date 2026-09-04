import { execFile as execFileCallback } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import {
    chmod,
    copyFile,
    lstat,
    mkdir,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { listFiles } from '../integrity.mjs';
import { fail, validRelative } from '../schema.mjs';

const execFile = promisify(execFileCallback);

const systemTar = (platform = process.platform, environment = process.env) => {
    if (platform === 'darwin') return '/usr/bin/tar';
    if (platform === 'win32') {
        const root = environment.SystemRoot || 'C:\\Windows';
        return path.win32.join(root, 'System32', 'tar.exe');
    }
    if (platform === 'linux') return '/usr/bin/tar';
    fail(`No trusted system archive tool for ${platform}`);
};

export const runArchiveTool = async (program, args) => {
    try {
        await execFile(program, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    } catch (error) {
        fail(`Archive extraction failed: ${program}: ${error.message}`);
    }
};

const validateMembers = (members) => {
    if (!Array.isArray(members) || members.length === 0 || new Set(members).size !== members.length) {
        fail('Archive member selection must be non-empty and unique');
    }
    for (const member of members) {
        if (!validRelative(member) || member.startsWith('-')) {
            fail(`Unsafe archive member: ${member}`);
        }
    }
};

export const extractExactMembers = async ({
    archive,
    members,
    destination,
    platform = process.platform,
    environment = process.env,
    runner = runArchiveTool,
}) => {
    validateMembers(members);
    await mkdir(destination, { recursive: false, mode: 0o755 });
    await runner(systemTar(platform, environment), [
        '-xf',
        archive,
        '-C',
        destination,
        '--',
        ...members,
    ]);
    const actual = await listFiles(destination);
    const expected = [...members].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        fail(`Archive extraction produced an unexpected file set: ${actual.join(', ')}`);
    }
    for (const member of members) {
        const stats = await lstat(path.join(destination, member));
        if (!stats.isFile() || stats.isSymbolicLink()) {
            fail(`Extracted member is not a regular file: ${member}`);
        }
    }
};

const copyExecutable = async (from, to, platform) => {
    await copyFile(from, to, fsConstants.COPYFILE_EXCL);
    if (platform !== 'win32') await chmod(to, 0o755);
};

export const prepareSourceTree = async ({
    workDirectory,
    assetArchive,
    sourceArchive,
    target,
    source,
    platform = process.platform,
    runner = runArchiveTool,
}) => {
    const assetExtract = path.join(workDirectory, 'asset-extract');
    const sourceExtract = path.join(workDirectory, 'source-extract');
    const input = path.join(workDirectory, 'approved-input');
    const bin = path.join(input, 'bin');
    await mkdir(bin, { recursive: true, mode: 0o755 });
    await extractExactMembers({
        archive: assetArchive,
        members: [target.ffmpeg_member, target.ffprobe_member],
        destination: assetExtract,
        platform,
        runner,
    });
    await extractExactMembers({
        archive: sourceArchive,
        members: source.license_files.map(({ member }) => member),
        destination: sourceExtract,
        platform,
        runner,
    });
    const extension = target.distribution_target.startsWith('windows-') ? '.exe' : '';
    await copyExecutable(
        path.join(assetExtract, target.ffmpeg_member),
        path.join(bin, `ffmpeg${extension}`),
        platform,
    );
    await copyExecutable(
        path.join(assetExtract, target.ffprobe_member),
        path.join(bin, `ffprobe${extension}`),
        platform,
    );
    return {
        input,
        ffmpeg: path.join(bin, `ffmpeg${extension}`),
        ffprobe: path.join(bin, `ffprobe${extension}`),
        licenses: source.license_files.map(({ member, file }) => ({
            source: path.join(sourceExtract, member),
            file,
        })),
    };
};
