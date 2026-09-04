import fs from 'node:fs';

describe('updater release workflow safety', () => {
    const stage = fs.readFileSync('.github/workflows/release.yml', 'utf8');
    const promote = fs.readFileSync('.github/workflows/promote-updater-candidate.yml', 'utf8');
    const repair = fs.readFileSync('.github/workflows/repair-updater-manifest.yml', 'utf8');
    const macVerifier = fs.readFileSync('scripts/verify-macos-distribution.sh', 'utf8');
    const config = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
    const acceptanceConfig = JSON.parse(fs.readFileSync('src-tauri/tauri.acceptance.conf.json', 'utf8'));

    it('stages a private byte ledger without publishing or accepting a public tag trigger', () => {
        expect(stage).toContain('stage-private-updater-candidate:');
        expect(stage).toContain('updater-staging-ledger.mjs create');
        expect(stage).toContain('remains a private draft');
        expect(stage).not.toContain('gh release edit "$TAG" --repo "$REPO" --draft=false');
        expect(stage).not.toMatch(/\n\s+tags:\s*\n/);
    });

    it('promotes only through a separate manual exact-byte and receipt gate', () => {
        expect(promote).toContain('workflow_dispatch:');
        expect(promote).toContain('ref: ${{ inputs.expected_commit }}');
        expect(promote).toContain('updater-staging-ledger.mjs verify');
        expect(promote).toContain('updater-staging-ledger.mjs verify-receipt');
        expect(promote).toContain('cmp "$RUNNER_TEMP/reproduced-latest.json" "$asset_dir/latest.json"');
        expect(promote.match(/updater-staging-ledger\.mjs verify \\/g)).toHaveLength(2);
        expect(promote).toContain("before.updated_at !== release.updated_at");
        expect(promote).toContain('test "$CONFIRMATION" = "PUBLISH $TAG"');
        expect(promote).not.toContain('tauri-action');
        expect(promote).toContain('gh release edit "$TAG" --repo "$REPO" --draft=false');
    });

    it('keeps production clients on HTTPS latest and keeps repair public-only', () => {
        expect(config.plugins.updater.endpoints).toEqual([
            'https://github.com/ivg-design/rive-animation-viewer/releases/latest/download/latest.json',
        ]);
        expect(config.plugins.updater.dangerousInsecureTransportProtocol).not.toBe(true);
        expect(acceptanceConfig.plugins.updater.dangerousInsecureTransportProtocol).toBe(true);
        expect(repair).toContain('Updater repair is only allowed for an already-published release');
    });

    it('validates one healthy counter endpoint before draft creation and shares it across builds', () => {
        const healthGate = stage.indexOf('Validate the canonical anonymous counter endpoint');
        const draftCreation = stage.indexOf('Create or validate the draft release');
        expect(healthGate).toBeGreaterThan(-1);
        expect(draftCreation).toBeGreaterThan(healthGate);
        expect(stage).toContain("new URL('/v1/health', endpoint)");
        expect(stage).toContain('counter_endpoint: ${{ steps.counter.outputs.endpoint }}');
        expect(stage.match(/needs\.prepare-release\.outputs\.counter_endpoint/g)).toHaveLength(2);
        expect(stage.match(/vars\.RAV_COUNTER_ENDPOINT/g)).toHaveLength(1);
    });

    it('acquires the pinned production encoders before every platform build', () => {
        expect(stage.match(/encoders\.mjs acquire/g)).toHaveLength(2);
        expect(stage).toContain('--target "$RAV_ENCODER_TARGET"');
        expect(stage).toContain('--mac-signing-identity "$APPLE_SIGNING_IDENTITY"');
        expect(stage).toContain('RAV_ENCODER_TARGET: x86_64-pc-windows-msvc');
        expect(stage).toContain('APPLE_SIGNING_IDENTITY: ${{ steps.apple.outputs.signing_identity }}');
        expect(stage).toContain('security list-keychains -d user -s "$keychain_path"');
        expect(stage).not.toMatch(/gifski/i);
    });

    it('requires the exact corresponding source in the private byte ledger', () => {
        expect(stage).toContain('jellyfin-ffmpeg-v7.1.4-3-source.tar.gz');
        expect(stage).toContain('38fff90f73b3c4f9c3c7270711411a4ec3cbe63b205d4b4a5525bcc532d3d31f');
        expect(stage).toContain('16698965');
        expect(stage).not.toMatch(/exit 1\s*\n\s*exit 1/);
    });

    it('verifies only manifest-declared signed macOS encoder executables', () => {
        expect(macVerifier).toContain('encoders.mjs" verify-bundle');
        expect(macVerifier).toContain('encoders/ffmpeg | encoders/ffprobe');
        expect(macVerifier).toContain('require_signature_contract "$encoder"');
        expect(macVerifier).toContain('require_hardened_runtime "$encoder"');
        expect(macVerifier).toContain('require_architecture "$encoder"');
        expect(macVerifier).toContain('undeclared Mach-O executable in Resources');
    });
});
