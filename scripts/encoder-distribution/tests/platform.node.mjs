import assert from 'node:assert/strict';
import test from 'node:test';
import {
    assertInspectionHost,
    inspectNativeBinary,
} from '../platform.mjs';

const macCommands = (advertisedArch) => async (program, args) => {
    if (program === '/usr/bin/file') return `Mach-O 64-bit executable ${advertisedArch}\n`;
    if (program === '/usr/bin/lipo') return `${advertisedArch}\n`;
    if (program === '/usr/bin/otool') {
        return `${args.at(-1)}:\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0)\n`;
    }
    if (program === '/usr/bin/codesign') return '';
    throw new Error(`unexpected command ${program}`);
};

test('an arm64 macOS host can inspect the x86_64 macOS release asset', async () => {
    const compatibility = assertInspectionHost('macos-x86_64', {
        platform: 'darwin',
        arch: 'arm64',
    });
    assert.equal(compatibility.hostArch, 'arm64');
    await inspectNativeBinary('/release/ffmpeg', 'macos-x86_64', {
        platform: 'darwin',
        arch: 'arm64',
        runCommand: macCommands('x86_64'),
    });
});

test('an x86_64 macOS host can inspect the arm64 macOS release asset', async () => {
    const compatibility = assertInspectionHost('macos-aarch64', {
        platform: 'darwin',
        arch: 'x64',
    });
    assert.equal(compatibility.hostArch, 'x64');
    await inspectNativeBinary('/release/ffprobe', 'macos-aarch64', {
        platform: 'darwin',
        arch: 'x64',
        runCommand: macCommands('arm64'),
    });
});

test('native inspection still rejects cross-OS targets', async () => {
    assert.throws(
        () => assertInspectionHost('windows-x86_64', { platform: 'darwin', arch: 'arm64' }),
        /cannot inspect cross-OS/,
    );
});

test('Windows inspection verifies the PE machine architecture', async () => {
    const pe = Buffer.alloc(128);
    pe.write('MZ', 0, 'ascii');
    pe.writeUInt32LE(64, 0x3c);
    pe.write('PE\0\0', 64, 'ascii');
    pe.writeUInt16LE(0x8664, 68);
    await inspectNativeBinary('C:\\release\\ffmpeg.exe', 'windows-x86_64', {
        platform: 'win32',
        arch: 'x64',
        readBytes: async () => pe,
    });
    pe.writeUInt16LE(0xaa64, 68);
    await assert.rejects(
        inspectNativeBinary('C:\\release\\ffmpeg.exe', 'windows-x86_64', {
            platform: 'win32',
            arch: 'x64',
            readBytes: async () => pe,
        }),
        /architecture does not match/,
    );
});
