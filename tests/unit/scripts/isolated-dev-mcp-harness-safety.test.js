import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const harness = resolve('scripts/isolated-dev-mcp-acceptance-harness.mjs');

function runHarness(args) {
    return spawnSync(process.execPath, [harness, ...args], {
        encoding: 'utf8',
    });
}

describe('isolated DEV MCP acceptance harness safety', () => {
    const base = [
        '--sidecar', '/tmp/RAV 2.5.2 DEV.app/Contents/MacOS/rav-mcp',
        '--port', '9278',
        '--scenario', '/tmp/scenario.json',
    ];

    it('requires the exact app identity before it can start a sidecar', () => {
        const result = runHarness(base);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('--expected-build <exact build stamp>');
        expect(result.stderr).toContain('--expected-sidecar-sha256 <sha256>');
        expect(result.stderr).toContain('--expected-scenario-sha256 <sha256>');
    });

    it('refuses production and non-DEV targets before filesystem access', () => {
        const identity = [
            '--expected-build', 'b0217-20260827-0300-645bfa9',
            '--expected-version', '2.5.2',
            '--expected-channel', 'dev',
            '--expected-sidecar-sha256', '0'.repeat(64),
            '--expected-scenario-sha256', '0'.repeat(64),
        ];
        const productionPort = runHarness([
            ...base.slice(0, 2), '--port', '9274', ...base.slice(4), ...identity,
        ]);
        const releaseChannel = runHarness([
            ...base,
            '--expected-build', 'b0217-20260827-0300-645bfa9',
            '--expected-version', '2.5.2',
            '--expected-channel', 'release',
            '--expected-sidecar-sha256', '0'.repeat(64),
            '--expected-scenario-sha256', '0'.repeat(64),
        ]);

        expect(productionPort.status).toBe(1);
        expect(productionPort.stderr).toContain('only accepts isolated DEV port 9278');
        expect(releaseChannel.status).toBe(1);
        expect(releaseChannel.stderr).toContain('Refusing a non-DEV expected channel');
    });

    it('pins the exact sidecar digest before loading a scenario or spawning MCP', () => {
        const result = runHarness([
            '--sidecar', process.execPath,
            '--port', '9278',
            '--scenario', '/tmp/does-not-exist-rav-scenario.json',
            '--expected-build', 'b0217-20260827-0300-645bfa9',
            '--expected-version', '2.5.2',
            '--expected-channel', 'dev',
            '--expected-sidecar-sha256', '0'.repeat(64),
            '--expected-scenario-sha256', '0'.repeat(64),
        ]);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('sidecar SHA-256 does not match the pinned digest');
        expect(result.stderr).not.toContain('does-not-exist-rav-scenario');
    });

    it('keeps closure-critical live assertions fail-closed', () => {
        const source = readFileSync(harness, 'utf8');

        expect(source).toContain('for (const [stepIndex, alias] of scenario.openSequence.entries())');
        expect(source).toContain('scenarioSha256: actualScenarioSha256');
        expect(source).toContain('assertTimelineMetrics(first.playback');
        expect(source).toContain('frame and seconds clocks disagree at the reported FPS');
        expect(source).toContain("['currentFrame', 'currentSeconds', 'durationSeconds', 'fps', 'totalFrames', 'totalSeconds']");
        expect(source).toContain('next.vmInstanceKey === String(instance)');
        expect(source).toContain("instance === 'auto' ? null : String(instance)");
        expect(source).toContain("Object.prototype.hasOwnProperty.call(switched, 'instanceKey')");
        expect(source).toContain('next.vmHasRoot && next.vmPathCount > 0');
        expect(source).toContain('numeric and automatic VM instance transitions');
        expect(source).toContain('independent image slots replay through playback reset, default reset, and A/B/A');
        expect(source).toContain('config.replayThroughFile !== config.file');
        expect(source).toContain("await client.tool('rav_reset_artboard')");
        expect(source).toContain('runtime list shrink and stale-path rejection');
        expect(source).toContain('samePathMultiset(candidatePaths, beforePaths)');
        expect(source).not.toContain('candidatePaths.length === beforePaths.length');
        expect(source).toContain('/not found|not readable|out of bounds/i.test(stalePathError.message)');
        expect(source).toContain('current.renderSurface.sessionId === beforeCommand.renderSurface.sessionId');
        expect(source).toContain('current.renderSurface.sessionId !== beforeCommand.renderSurface.sessionId');
        expect(source).toContain('receipt.skipped.length === 0');
        expect(source).toContain('Duplicate acceptance assertion name');
    });
});
