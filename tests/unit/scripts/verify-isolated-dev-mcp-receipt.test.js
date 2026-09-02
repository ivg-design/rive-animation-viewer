import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    REQUIRED_ASSERTIONS,
    verifyReceipt,
} from '../../../scripts/verify-isolated-dev-mcp-receipt.mjs';

function fixture() {
    const directory = mkdtempSync(join(tmpdir(), 'rav-receipt-'));
    const sidecar = join(directory, 'RAV 2.5.4 DEV.app', 'Contents', 'MacOS', 'rav-mcp');
    const scenario = join(directory, 'scenario.json');
    const scenarioText = JSON.stringify({
        files: { a: '/tmp/a.riv', b: '/tmp/b.riv' },
        globalViewModel: { file: 'a', name: 'GlobalLabels', path: 'label', value: 'Changed' },
        instanceModes: { file: 'numericInstance', instances: [0, 'auto'] },
        images: { file: 'b', replayThroughFile: 'a', paths: ['left/image', 'right/image'] },
        listGrowth: { shrinkTriggerPath: 'popButton/onClick' },
        openRepeats: 2,
        openSequence: ['a', 'b', 'a'],
    });
    mkdirSync(join(directory, 'RAV 2.5.4 DEV.app', 'Contents', 'MacOS'), { recursive: true });
    writeFileSync(sidecar, 'sidecar');
    writeFileSync(scenario, scenarioText);
    const openAssertions = [];
    for (let repetition = 1; repetition <= 2; repetition += 1) {
        for (const [stepIndex, alias] of ['a', 'b', 'a'].entries()) {
            openAssertions.push({
                name: `open sequence ${repetition}/2 step ${stepIndex + 1}/3: ${alias}`,
                ok: true,
            });
        }
    }
    openAssertions.push({ name: 'global VM: open a', ok: true });
    const expectedSidecarSha256 = createHash('sha256').update('sidecar').digest('hex');
    const expectedScenarioSha256 = createHash('sha256').update(scenarioText).digest('hex');
    const options = {
        expectedBuild: 'b0217-20260827-0300-645bfa9-dirty',
        expectedVersion: '2.5.4',
        expectedChannel: 'dev',
        sidecarPath: sidecar,
        scenarioPath: scenario,
        expectedSidecarSha256,
        expectedScenarioSha256,
    };
    return {
        options,
        receipt: {
            harness: 'rav-isolated-dev-mcp-acceptance',
            target: {
                port: 9278,
                sidecar,
                sidecarSha256: expectedSidecarSha256,
                scenario,
                scenarioSha256: expectedScenarioSha256,
                expectedApp: {
                    build: options.expectedBuild,
                    version: options.expectedVersion,
                    channel: options.expectedChannel,
                },
            },
            passed: true,
            failures: [],
            skipped: [],
            assertions: [
                ...openAssertions,
                ...REQUIRED_ASSERTIONS.map((name) => ({
                    name,
                    ok: true,
                    ...(name === 'tools/list: exact 49 unique tools including GVM/capture names'
                        ? { count: 49, names: [
                            'rav_get_global_vm_tree', 'rav_global_vm_get', 'rav_global_vm_set',
                            'rav_global_vm_fire', 'rav_global_vm_set_image', 'rav_global_vm_clear_image',
                            'rav_capture_canvas', ...Array.from({ length: 42 }, (_, index) => `tool-${index}`),
                        ] } : {}),
                    ...(name === 'global VM tree/get/set/restore'
                        ? { globalViewModelName: 'GlobalLabels', path: 'label', original: 'Original', restored: 'Original' } : {}),
                    ...(name === 'capture: valid PNG byte length matches metadata'
                        ? { mimeType: 'image/png', decodedByteLength: 128, metadataByteLength: 128 } : {}),
                })),
            ],
        },
    };
}

describe('isolated DEV MCP receipt verifier', () => {
    it('accepts the exact harness receipt shape and pinned files', () => {
        const current = fixture();
        expect(verifyReceipt(current.receipt, current.options)).toMatchObject({
            build: current.options.expectedBuild,
            version: '2.5.4',
        });
    });

    it('rejects build drift, hash drift, skipped checks, and missing assertions', () => {
        const current = fixture();
        current.receipt.target.expectedApp.build = 'b0218-20260827-0400-645bfa9-dirty';
        expect(() => verifyReceipt(current.receipt, current.options)).toThrow(/identity/);

        current.receipt.target.expectedApp.build = current.options.expectedBuild;
        current.receipt.target.sidecarSha256 = '0'.repeat(64);
        expect(() => verifyReceipt(current.receipt, current.options)).toThrow(/Sidecar SHA-256/);

        current.receipt.target.sidecarSha256 = current.options.expectedSidecarSha256;
        current.receipt.skipped.push({ name: 'images', reason: 'unsupported' });
        expect(() => verifyReceipt(current.receipt, current.options)).toThrow(/skipped/);

        current.receipt.skipped = [];
        current.receipt.assertions.pop();
        expect(() => verifyReceipt(current.receipt, current.options)).toThrow(/missing required/);
    });

    it('rejects a scenario that omits the numeric-to-auto sequence, list shrink, or image replay', () => {
        const missingNumeric = fixture();
        const missingNumericScenario = JSON.stringify({
            files: { a: '/tmp/a.riv', b: '/tmp/b.riv' },
            globalViewModel: { file: 'a', name: 'GlobalLabels', path: 'label', value: 'Changed' },
            instanceModes: { file: 'numericInstance', instances: ['auto', 0] },
            images: { file: 'b', replayThroughFile: 'a', paths: ['left/image', 'right/image'] },
            listGrowth: { shrinkTriggerPath: 'popButton/onClick' },
            openRepeats: 2,
            openSequence: ['a', 'b', 'a'],
        });
        writeFileSync(missingNumeric.options.scenarioPath, missingNumericScenario);
        missingNumeric.options.expectedScenarioSha256 = createHash('sha256').update(missingNumericScenario).digest('hex');
        missingNumeric.receipt.target.scenarioSha256 = missingNumeric.options.expectedScenarioSha256;
        expect(() => verifyReceipt(missingNumeric.receipt, missingNumeric.options)).toThrow(/numeric instance 0/);

        const missingShrink = fixture();
        const missingShrinkScenario = JSON.stringify({
            files: { a: '/tmp/a.riv', b: '/tmp/b.riv' },
            globalViewModel: { file: 'a', name: 'GlobalLabels', path: 'label', value: 'Changed' },
            instanceModes: { file: 'numericInstance', instances: [0, 'auto'] },
            images: { file: 'b', replayThroughFile: 'a', paths: ['left/image', 'right/image'] },
            openRepeats: 2,
            openSequence: ['a', 'b', 'a'],
        });
        writeFileSync(missingShrink.options.scenarioPath, missingShrinkScenario);
        missingShrink.options.expectedScenarioSha256 = createHash('sha256').update(missingShrinkScenario).digest('hex');
        missingShrink.receipt.target.scenarioSha256 = missingShrink.options.expectedScenarioSha256;
        expect(() => verifyReceipt(missingShrink.receipt, missingShrink.options)).toThrow(/runtime list shrink/);

        const missingImageReplay = fixture();
        const missingImageReplayScenario = JSON.stringify({
            files: { a: '/tmp/a.riv', b: '/tmp/b.riv' },
            globalViewModel: { file: 'a', name: 'GlobalLabels', path: 'label', value: 'Changed' },
            instanceModes: { file: 'numericInstance', instances: [0, 'auto'] },
            images: { file: 'b', replayThroughFile: 'b', paths: ['left/image', 'right/image'] },
            listGrowth: { shrinkTriggerPath: 'popButton/onClick' },
            openRepeats: 2,
            openSequence: ['a', 'b', 'a'],
        });
        writeFileSync(missingImageReplay.options.scenarioPath, missingImageReplayScenario);
        missingImageReplay.options.expectedScenarioSha256 = createHash('sha256')
            .update(missingImageReplayScenario).digest('hex');
        missingImageReplay.receipt.target.scenarioSha256 = missingImageReplay.options.expectedScenarioSha256;
        expect(() => verifyReceipt(missingImageReplay.receipt, missingImageReplay.options))
            .toThrow(/two independent image slots/);
    });
});
