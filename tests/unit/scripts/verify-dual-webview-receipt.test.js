import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());
const verifier = resolve(root, 'scripts/verify-dual-webview-receipt.mjs');
const template = resolve(root, '.github/dual-webview-gate-receipt.template.json');

function completeReceipt() {
    const receipt = JSON.parse(readFileSync(template, 'utf8'));
    Object.assign(receipt, {
        buildStamp: 'v2.5.2-release-candidate',
        platform: 'macOS',
        fixture: 'release acceptance fixtures',
        validatedAt: '2026-08-27T12:00:00Z',
        validator: 'release operator',
        automatedTests: 'passed',
    });
    for (const assertion of Object.keys(receipt.assertions)) {
        receipt.assertions[assertion] = 'passed';
    }
    return receipt;
}

function verify(receipt) {
    const directory = mkdtempSync(join(tmpdir(), 'rav-dual-webview-receipt-'));
    const receiptPath = join(directory, 'receipt.json');
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    return spawnSync(process.execPath, [verifier, '--receipt', receiptPath], {
        cwd: root,
        encoding: 'utf8',
    });
}

describe('dual-WebView receipt verifier', () => {
    it('accepts a completed copy of the tracked release template', () => {
        const result = verify(completeReceipt());
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('Dual-WebView release receipt verified');
    });

    it('rejects every newly documented native visual assertion when omitted', () => {
        const required = [
            'staticPausedFinishedActivation',
            'rapidSwitchingRejectsStaleResults',
            'overlayPlaybackContinuity',
            'overlayOutsideClickAndToolbarToggle',
            'overlayChromeAndScrollbarStyling',
            'overlayFocusStyling',
            'invalidFixedDimensionValidation',
        ];

        for (const assertion of required) {
            const receipt = completeReceipt();
            delete receipt.assertions[assertion];
            const result = verify(receipt);
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain(assertion);
        }
    });
});
