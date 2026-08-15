import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath, encoding = null) {
    return fs.readFileSync(path.join(repoRoot, relativePath), encoding);
}

export function inspectIco(buffer) {
    assert.equal(buffer.readUInt16LE(0), 0, 'ICO reserved field must be zero');
    assert.equal(buffer.readUInt16LE(2), 1, 'ICO resource type must be icon');

    const count = buffer.readUInt16LE(4);
    const entries = [];
    for (let index = 0; index < count; index += 1) {
        const offset = 6 + (index * 16);
        const widthByte = buffer.readUInt8(offset);
        const heightByte = buffer.readUInt8(offset + 1);
        const bytesInResource = buffer.readUInt32LE(offset + 8);
        const imageOffset = buffer.readUInt32LE(offset + 12);

        assert.ok(bytesInResource > 0, `ICO frame ${index} must contain image data`);
        assert.ok(imageOffset >= 6 + (count * 16), `ICO frame ${index} overlaps its directory`);
        assert.ok(imageOffset + bytesInResource <= buffer.length, `ICO frame ${index} exceeds the file`);

        entries.push({
            width: widthByte || 256,
            height: heightByte || 256,
            planes: buffer.readUInt16LE(offset + 4),
            bitsPerPixel: buffer.readUInt16LE(offset + 6),
            bytesInResource,
            imageOffset,
        });
    }
    return entries;
}

export function verifyWindowsDocumentIcon() {
    const baseConfig = JSON.parse(read('src-tauri/tauri.conf.json', 'utf8'));
    const windowsConfig = JSON.parse(read('src-tauri/tauri.windows.conf.json', 'utf8'));
    const association = baseConfig.bundle.fileAssociations.find((item) => item.ext?.includes('riv'));

    assert.equal(association?.name, 'Rive File', 'NSIS hook must target Tauri\'s generated ProgId');
    assert.equal(
        windowsConfig.bundle.resources['icons/RiveFileIcon.ico'],
        'RiveFileIcon.ico',
        'Windows bundle must install the dedicated icon at the app root',
    );
    assert.equal(
        windowsConfig.bundle.windows.nsis.installerHooks,
        'windows/nsis-hooks.nsh',
        'NSIS installer hook must be configured',
    );

    const nsisHook = read('src-tauri/windows/nsis-hooks.nsh', 'utf8');
    const preInstall = nsisHook.match(/!macro NSIS_HOOK_PREINSTALL([\s\S]*?)!macroend/)?.[1] || '';
    const postInstall = nsisHook.match(/!macro NSIS_HOOK_POSTINSTALL([\s\S]*?)!macroend/)?.[1] || '';
    const postUninstall = nsisHook.match(/!macro NSIS_HOOK_POSTUNINSTALL([\s\S]*?)!macroend/)?.[1] || '';
    assert.match(preInstall, /ReadRegStr .* "Software\\Classes\\\.riv" "Rive File_backup"/);
    assert.match(preInstall, /RavRivAssociationBackupExisted/);
    assert.match(preInstall, /\$\{IfNot\} \$\{Errors\}/);
    assert.match(preInstall, /ReadRegStr .* "Software\\Classes\\\.riv" ""/);
    assert.match(preInstall, /\$R0 == "Rive File"/);
    assert.ok(preInstall.trim().endsWith('ClearErrors'), 'NSIS preinstall hook must not leak lookup error state');
    assert.match(
        postInstall,
        /WriteRegStr SHCTX "Software\\Classes\\\.riv" "Rive File_backup" "\$RavPreviousRivAssociationBackup"/,
        'NSIS update/repair must retain the pre-RAV association for uninstall',
    );
    assert.match(
        postInstall,
        /DeleteRegValue SHCTX "Software\\Classes\\\.riv" "Rive File_backup"/,
        'NSIS update/repair must preserve an originally absent backup value',
    );
    assert.match(
        postInstall,
        /WriteRegStr SHCTX "Software\\Classes\\Rive File\\DefaultIcon" "" "\$\\"\$INSTDIR\\RiveFileIcon\.ico\$\\",0"/,
        'NSIS install/repair/update must overwrite the generated executable icon',
    );
    assert.match(postInstall, /!insertmacro UPDATEFILEASSOC/, 'NSIS install must refresh Explorer');
    assert.match(
        postUninstall,
        /DeleteRegValue SHCTX "Software\\Classes\\\.riv" "Rive File_backup"/,
        'NSIS uninstall must remove only its association backup value',
    );
    assert.match(
        postUninstall,
        /DeleteRegKey \/ifempty SHCTX "Software\\Classes\\\.riv"/,
        'NSIS uninstall must remove the extension key only when no restored handler uses it',
    );
    assert.match(postUninstall, /!insertmacro UPDATEFILEASSOC/, 'NSIS uninstall must refresh Explorer');
    assert.doesNotMatch(
        postUninstall,
        /DeleteRegKey(?:\s+\/ifempty)? SHCTX "Software\\Classes\\Rive File"/,
        'Custom hook must leave Rive File class ownership and cleanup to Tauri',
    );

    const wix = windowsConfig.bundle.windows.wix;
    assert.deepEqual(wix.fragmentPaths, ['windows/wix-rive-document-icon.wxs']);
    assert.deepEqual(wix.componentRefs, ['RiveDocumentIconRegistry']);

    const wixFragment = read('src-tauri/windows/wix-rive-document-icon.wxs', 'utf8');
    assert.match(wixFragment, /Id="RiveDocumentIconRegistry"/);
    assert.match(wixFragment, /<\?elseif \$\(sys\.BUILDARCH\)="arm64"\?>/);
    assert.match(wixFragment, /Win64="\$\(var\.Win64\)"/);
    assert.match(wixFragment, /Root="HKLM"/);
    assert.match(wixFragment, /Key="Software\\Classes\\Rive Animation Viewer\.riv\\DefaultIcon"/);
    assert.match(wixFragment, /Value="&quot;\[INSTALLDIR\]RiveFileIcon\.ico&quot;,0"/);
    assert.match(wixFragment, /KeyPath="yes"/);

    const acceptanceScript = read('scripts/verify-windows-document-icon.ps1', 'utf8');
    assert.match(acceptanceScript, /\[string\]\$ExpectedVersion/);
    assert.match(acceptanceScript, /ProductVersion -ne \$ExpectedVersion/);
    assert.match(acceptanceScript, /__TAURI_BUNDLE_TYPE_VAR_\$ExpectedBundleType/);
    assert.match(acceptanceScript, /Registry::HKEY_CURRENT_USER\\Software\\Classes/);
    assert.match(acceptanceScript, /Registry::HKEY_LOCAL_MACHINE\\Software\\Classes/);
    assert.match(acceptanceScript, /Rive Animation Viewer\.riv/);
    assert.match(acceptanceScript, /MSI acceptance requires -InstallDir/);
    assert.match(acceptanceScript, /requires no HKCU \.riv or ProgID shadow/);
    assert.match(acceptanceScript, /Rive File_backup/);
    assert.match(acceptanceScript, /ExpectedPreviousProgId/);
    assert.match(acceptanceScript, /\\DefaultIcon/);
    assert.match(acceptanceScript, /still points at the application executable/);
    assert.match(acceptanceScript, /\$expectedDefaultIcon = "`"\$expectedIconPath`",0"/);
    assert.match(acceptanceScript, /RiveFileIcon\.ico/);
    assert.match(acceptanceScript, /Get-FileHash .* -Algorithm SHA256/);
    assert.match(acceptanceScript, /ExpectedIconSha256/);

    const ico = read('src-tauri/icons/RiveFileIcon.ico');
    const frames = inspectIco(ico);
    assert.deepEqual(
        frames.map(({ width, height }) => `${width}x${height}`),
        ['256x256', '128x128', '96x96', '64x64', '48x48', '40x40', '32x32', '24x24', '20x20', '16x16'],
        'Dedicated Windows icon must contain the complete multi-resolution set',
    );
    for (const frame of frames) {
        assert.equal(frame.planes, 1, `${frame.width}px ICO frame must have one color plane`);
        assert.equal(frame.bitsPerPixel, 32, `${frame.width}px ICO frame must retain RGBA`);
    }

    return {
        frames: frames.length,
        sha256: crypto.createHash('sha256').update(ico).digest('hex'),
    };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const result = verifyWindowsDocumentIcon();
    console.log(`Windows .riv document icon verified: ${result.frames} frames, sha256 ${result.sha256}`);
}
