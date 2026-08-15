import fs from 'node:fs';

describe('updater release workflow safety', () => {
    const stage = fs.readFileSync('.github/workflows/release.yml', 'utf8');
    const promote = fs.readFileSync('.github/workflows/promote-updater-candidate.yml', 'utf8');
    const repair = fs.readFileSync('.github/workflows/repair-updater-manifest.yml', 'utf8');
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
});
