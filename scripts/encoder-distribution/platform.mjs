import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fail, PACKAGE_MANAGER_ROOTS } from './schema.mjs';

const execFile = promisify(execFileCallback);

export const command = async (program, args) => {
    try {
        return (await execFile(program, args, {
            encoding: 'utf8',
            maxBuffer: 4 * 1024 * 1024,
        })).stdout;
    } catch (error) {
        fail(`Platform binary inspection failed: ${program} ${args.join(' ')}: ${error.message}`);
    }
};

const inspectMac = async (file, arch, runCommand) => {
    const kind = await runCommand('/usr/bin/file', ['-b', file]);
    if (!kind.includes('Mach-O')) fail(`Production macOS encoder is not Mach-O: ${file}`);
    const architectures = (await runCommand('/usr/bin/lipo', ['-archs', file])).trim().split(/\s+/);
    const expected = arch === 'aarch64' ? 'arm64' : arch;
    if (!architectures.includes(expected)) fail(`Encoder ${file} does not contain ${expected}`);
    const dependencies = await runCommand('/usr/bin/otool', ['-L', file]);
    for (const line of dependencies.split('\n').slice(1).map((item) => item.trim()).filter(Boolean)) {
        const dependency = line.split(/\s+\(/)[0];
        if (PACKAGE_MANAGER_ROOTS.some((root) => dependency.startsWith(root))) {
            fail(`Encoder has a package-manager runtime dependency: ${dependency}`);
        }
        if (dependency.startsWith('@')) {
            fail(`Encoder has an undeclared bundle-relative runtime dependency: ${dependency}`);
        }
        if (dependency.startsWith('/')
            && !dependency.startsWith('/usr/lib/')
            && !dependency.startsWith('/System/Library/')) {
            fail(`Encoder has an unbundled absolute runtime dependency: ${dependency}`);
        }
    }
    await runCommand('/usr/bin/codesign', ['--verify', '--strict', file]);
};

const inspectLinux = async (file, runCommand) => {
    const kind = await runCommand('/usr/bin/file', ['-b', file]);
    if (!kind.includes('ELF')) fail(`Production Linux encoder is not ELF: ${file}`);
    const dependencies = await runCommand('/usr/bin/ldd', [file]);
    if (/not found/i.test(dependencies)) fail(`Encoder has unresolved Linux dependencies: ${file}`);
    if (PACKAGE_MANAGER_ROOTS.some((root) => dependencies.includes(root))) {
        fail(`Encoder has a package-manager runtime dependency: ${file}`);
    }
};

const inspectWindows = async (file, arch, readBytes) => {
    const bytes = await readBytes(file);
    if (bytes.length < 64 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
        fail(`Production Windows encoder is not PE: ${file}`);
    }
    const peOffset = bytes.readUInt32LE(0x3c);
    if (peOffset + 6 > bytes.length || bytes.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
        fail(`Production Windows encoder has an invalid PE header: ${file}`);
    }
    const expectedMachine = { x86_64: 0x8664, aarch64: 0xaa64 }[arch];
    if (!expectedMachine || bytes.readUInt16LE(peOffset + 4) !== expectedMachine) {
        fail(`Production Windows encoder architecture does not match ${arch}: ${file}`);
    }
};

export const assertInspectionHost = (
    target,
    { platform = process.platform, arch = process.arch } = {},
) => {
    const separator = target.lastIndexOf('-');
    const os = target.slice(0, separator);
    const hostOs = { darwin: 'macos', win32: 'windows' }[platform] || platform;
    if (os !== hostOs) {
        fail(`Native inspection on ${hostOs} cannot inspect cross-OS target ${target}`);
    }
    return { os, arch: target.slice(separator + 1), hostArch: arch };
};

export const inspectNativeBinary = async (
    file,
    target,
    {
        platform = process.platform,
        arch = process.arch,
        runCommand = command,
        readBytes = readFile,
    } = {},
) => {
    const compatibility = assertInspectionHost(target, { platform, arch });
    if (compatibility.os === 'macos') return inspectMac(file, compatibility.arch, runCommand);
    if (compatibility.os === 'linux') return inspectLinux(file, runCommand);
    if (compatibility.os === 'windows') {
        return inspectWindows(file, compatibility.arch, readBytes);
    }
    fail(`Unsupported encoder distribution target: ${target}`);
};
