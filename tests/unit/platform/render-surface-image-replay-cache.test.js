import { createRenderSurfaceImageReplayCache } from '../../../src/app/platform/render-surface/image-replay-cache.js';
import { createRenderSurfaceCommandRelay } from '../../../src/app/platform/render-surface/command-buffer.js';
import { createRenderSurfaceEventRelay } from '../../../src/app/platform/render-surface/event-relay.js';
import { dispatchVmControlMutation } from '../../../src/app/rive/control-events.js';

function activateSource(cache, sessionId = 'active', sourceIdentity = 'file-1', vmInstanceKey = null, artboardKey = null) {
    cache.beginStage(sessionId);
    cache.setStagedSource(sessionId, sourceIdentity, vmInstanceKey, artboardKey);
    cache.commitStage(sessionId);
}

function acknowledge(cache, payload, targetSessionId = null) {
    cache.capture(payload, targetSessionId);
    return cache.resolveCommand({
        payload,
        result: { applied: true, status: 'applied' },
        targetSessionId,
    });
}

describe('platform/render-surface/image-replay-cache', () => {
    it('commits image bytes only after an applied acknowledgement', () => {
        const cache = createRenderSurfaceImageReplayCache();
        activateSource(cache);
        cache.beginStage('replacement');
        cache.setStagedSource('replacement', 'file-1');

        const setPayload = { action: 'set', kind: 'image', path: 'avatar', value: [1, 2, 3] };
        cache.capture(setPayload);
        expect(cache.replayForStage('replacement')).toEqual([]);

        cache.resolveCommand({ payload: setPayload, result: { applied: false, status: 'rejected' } });
        expect(cache.replayForStage('replacement')).toEqual([]);

        const successfulPayload = { ...setPayload, value: [4, 5, 6] };
        cache.capture(successfulPayload);
        cache.resolveCommand({ payload: successfulPayload, result: { applied: true, status: 'applied' } });
        expect(cache.replayForStage('replacement')).toEqual([
            expect.objectContaining({ path: 'avatar', value: [4, 5, 6] }),
        ]);
    });

    it('keeps the last acknowledged image when a clear is rejected or times out, then replays an applied clear', () => {
        const cache = createRenderSurfaceImageReplayCache();
        activateSource(cache);
        const setPayload = { action: 'set', kind: 'image', path: 'avatar', value: [1, 2, 3] };
        cache.capture(setPayload);
        cache.resolveCommand({ payload: setPayload, result: { applied: true, status: 'applied' } });

        cache.beginStage('replacement');
        cache.setStagedSource('replacement', 'file-1');
        const rejectedClear = { action: 'clear', kind: 'image', path: 'avatar', value: null };
        cache.capture(rejectedClear);
        cache.resolveCommand({ payload: rejectedClear, result: { applied: false, status: 'rejected' } });
        expect(cache.replayForStage('replacement')).toEqual([
            expect.objectContaining({ path: 'avatar', value: [1, 2, 3] }),
        ]);

        const timedOutClear = { ...rejectedClear };
        cache.capture(timedOutClear);
        cache.resolveCommand({ payload: timedOutClear, result: { applied: false, status: 'timeout' } });
        expect(cache.replayForStage('replacement')).toEqual([
            expect.objectContaining({ path: 'avatar', value: [1, 2, 3] }),
        ]);

        const appliedClear = { ...rejectedClear, action: 'clear-image' };
        cache.capture(appliedClear);
        cache.resolveCommand({ payload: appliedClear, result: { applied: true, status: 'applied' } });
        expect(cache.replayForStage('replacement')).toEqual([
            expect.objectContaining({ action: 'clear-image', imageSelection: null, path: 'avatar', value: null }),
        ]);

        cache.beginStage('different-file');
        cache.setStagedSource('different-file', 'file-2');
        expect(cache.replayForStage('different-file')).toEqual([]);
    });

    it('drops superseded provisional entries without crossing source identities', () => {
        const cache = createRenderSurfaceImageReplayCache();
        activateSource(cache);
        cache.beginStage('replacement');
        cache.setStagedSource('replacement', 'file-1');

        const first = { action: 'set', kind: 'image', path: 'avatar', value: [1] };
        const second = { action: 'set', kind: 'image', path: 'avatar', value: [2] };
        cache.capture(first);
        cache.resolveCommand({ payload: first, result: { applied: false, status: 'superseded' } });
        cache.capture(second);
        cache.resolveCommand({ payload: second, result: { applied: true, status: 'applied' } });
        expect(cache.replayForStage('replacement')).toEqual([
            expect.objectContaining({ path: 'avatar', value: [2] }),
        ]);

        cache.beginStage('different-file');
        cache.setStagedSource('different-file', 'file-2');
        expect(cache.replayForStage('different-file')).toEqual([]);
    });

    it('keeps nested and list-generated image paths isolated across same-source reset and reopen', () => {
        const cache = createRenderSurfaceImageReplayCache();
        activateSource(cache, 'active', 'riv-sha256');

        const acknowledge = (payload) => {
            cache.capture(payload);
            expect(cache.resolveCommand({
                payload,
                result: { applied: true, status: 'applied' },
            })).toBe(true);
        };
        acknowledge({
            action: 'set-image',
            kind: 'image',
            path: 'left/avatar',
            source: 'view-model',
            imageSelection: { kind: 'embedded', key: 'left.png', label: 'Left' },
            value: [1, 2],
        });
        acknowledge({
            action: 'set-image',
            kind: 'image',
            path: 'right/avatar',
            source: 'view-model',
            imageSelection: { kind: 'embedded', key: 'right.png', label: 'Right' },
            value: [3, 4],
        });
        acknowledge({
            action: 'set-image',
            kind: 'image',
            path: 'rows/0/avatar',
            source: 'view-model',
            imageSelection: { kind: 'file', label: 'row-1.webp' },
            value: [5, 6],
        });

        const replayPaths = (sessionId) => cache.replayForStage(sessionId).map((payload) => payload.path);
        cache.beginStage('same-source-reset');
        cache.setStagedSource('same-source-reset', 'riv-sha256');
        expect(replayPaths('same-source-reset')).toEqual([
            'left/avatar',
            'right/avatar',
            'rows/0/avatar',
        ]);

        // A clear for one list row must not clear the other nested controls.
        acknowledge({
            action: 'clear-image',
            kind: 'image',
            path: 'rows/0/avatar',
            source: 'view-model',
            imageSelection: null,
            value: null,
        });
        cache.beginStage('same-source-reopen');
        cache.setStagedSource('same-source-reopen', 'riv-sha256');
        expect(cache.replayForStage('same-source-reopen')).toEqual(expect.arrayContaining([
            expect.objectContaining({ path: 'left/avatar', value: [1, 2] }),
            expect.objectContaining({ path: 'right/avatar', value: [3, 4] }),
            expect.objectContaining({
                action: 'clear-image',
                path: 'rows/0/avatar',
                imageSelection: null,
                value: null,
            }),
        ]));

        // Growing the list adds one isolated path; it must not replace the
        // existing row or either nested image with the same leaf name.
        acknowledge({
            action: 'set-image',
            kind: 'image',
            path: 'rows/1/avatar',
            source: 'view-model',
            imageSelection: { kind: 'file', label: 'row-2.webp' },
            value: [7, 8],
        });
        cache.beginStage('same-source-grow');
        cache.setStagedSource('same-source-grow', 'riv-sha256');
        expect(replayPaths('same-source-grow')).toEqual([
            'left/avatar',
            'right/avatar',
            'rows/0/avatar',
            'rows/1/avatar',
        ]);

        cache.beginStage('different-source');
        cache.setStagedSource('different-source', 'other-riv-sha256');
        expect(cache.replayForStage('different-source')).toEqual([]);
    });

    it('retains external image bytes for A -> B -> A without replaying them into B', () => {
        const cache = createRenderSurfaceImageReplayCache();
        activateSource(cache, 'a-active', 'data-binding-images-test');
        const externalImage = {
            action: 'set-image',
            kind: 'image',
            path: 'avatar',
            source: 'view-model',
            imageSelection: { kind: 'file', label: 'external.png' },
            value: [7, 8, 9],
        };
        cache.capture(externalImage);
        cache.resolveCommand({ payload: externalImage, result: { applied: true, status: 'applied' } });

        cache.beginStage('b-open');
        cache.setStagedSource('b-open', 'other-file');
        expect(cache.replayForStage('b-open')).toEqual([]);
        cache.commitStage('b-open');

        cache.beginStage('a-reopen');
        cache.setStagedSource('a-reopen', 'data-binding-images-test');
        expect(cache.replayForStage('a-reopen')).toEqual([
            expect.objectContaining({
                imageSelection: { kind: 'file', label: 'external.png' },
                path: 'avatar',
                value: [7, 8, 9],
            }),
        ]);
    });

    it('keeps same-path image bytes separate for distinct bound ViewModel instances', () => {
        const cache = createRenderSurfaceImageReplayCache();
        activateSource(cache, 'first-instance', 'shared-file');
        const first = { action: 'set-image', kind: 'image', path: 'avatar', value: [1] };
        cache.capture(first);
        cache.resolveCommand({ payload: first, result: { applied: true, status: 'applied' } });

        cache.beginStage('second-instance');
        cache.setStagedSource('second-instance', 'shared-file', 'Inspector');
        cache.commitStage('second-instance');
        const second = { action: 'set-image', kind: 'image', path: 'avatar', value: [2] };
        cache.capture(second);
        cache.resolveCommand({ payload: second, result: { applied: true, status: 'applied' } });

        cache.beginStage('first-instance-reopen');
        cache.setStagedSource('first-instance-reopen', 'shared-file');
        expect(cache.replayForStage('first-instance-reopen')).toEqual([
            expect.objectContaining({ path: 'avatar', value: [1] }),
        ]);

        cache.beginStage('second-instance-reopen');
        cache.setStagedSource('second-instance-reopen', 'shared-file', 'Inspector');
        expect(cache.replayForStage('second-instance-reopen')).toEqual([
            expect.objectContaining({ path: 'avatar', value: [2] }),
        ]);
    });

    it('keeps runtime-generated instance key zero distinct from auto-bound image state', () => {
        const cache = createRenderSurfaceImageReplayCache();
        activateSource(cache, 'auto-instance', 'shared-file');
        expect(acknowledge(cache, {
            action: 'set-image', kind: 'image', path: 'avatar', value: [1],
        }, 'auto-instance')).toBe(true);

        activateSource(cache, 'runtime-zero', 'shared-file', 0);
        expect(acknowledge(cache, {
            action: 'set-image', kind: 'image', path: 'avatar', value: [2],
        }, 'runtime-zero')).toBe(true);

        cache.beginStage('auto-reopen');
        cache.setStagedSource('auto-reopen', 'shared-file');
        expect(cache.replayForStage('auto-reopen')).toEqual([
            expect.objectContaining({ path: 'avatar', value: [1] }),
        ]);

        cache.beginStage('runtime-zero-reopen');
        cache.setStagedSource('runtime-zero-reopen', 'shared-file', 0);
        expect(cache.replayForStage('runtime-zero-reopen')).toEqual([
            expect.objectContaining({ path: 'avatar', value: [2] }),
        ]);
    });

    it('commits a queued image only when its later flush receives an applied ACK', async () => {
        const cache = createRenderSurfaceImageReplayCache();
        activateSource(cache);
        cache.beginStage('replacement');
        cache.setStagedSource('replacement', 'file-1');

        let available = false;
        const relay = createRenderSurfaceCommandRelay({
            canSend: () => available,
            onResult: (delivery) => cache.resolveCommand(delivery),
            send: vi.fn(async () => ({ applied: true, status: 'applied' })),
        });
        const eventRelay = createRenderSurfaceEventRelay({
            commandRelay: relay,
            documentRef: document,
            onImageCommand: cache.capture,
        });
        eventRelay.setup();

        dispatchVmControlMutation(document, {
            action: 'set',
            descriptor: { kind: 'image', path: 'avatar', source: 'view-model' },
            imageSelection: { kind: 'embedded', key: 'first', label: 'First' },
            kind: 'image',
            value: [1],
        });
        dispatchVmControlMutation(document, {
            action: 'set',
            descriptor: { kind: 'image', path: 'avatar', source: 'view-model' },
            imageSelection: { kind: 'embedded', key: 'second', label: 'Second' },
            kind: 'image',
            value: [2],
        });
        expect(cache.replayForStage('replacement')).toEqual([]);

        available = true;
        await relay.flush();
        expect(cache.replayForStage('replacement')).toEqual([
            expect.objectContaining({
                imageSelection: { kind: 'embedded', key: 'second', label: 'Second' },
                path: 'avatar',
                value: [2],
            }),
        ]);
        eventRelay.dispose();
    });

    it('retains a provisional token across an automatic retry and commits only its later applied ACK', async () => {
        const cache = createRenderSurfaceImageReplayCache();
        activateSource(cache);
        cache.beginStage('replacement');
        cache.setStagedSource('replacement', 'file-1');

        let attempt = 0;
        const relay = createRenderSurfaceCommandRelay({
            canSend: () => true,
            onResult: (delivery) => cache.resolveCommand(delivery),
            send: vi.fn(async () => {
                attempt += 1;
                return attempt === 1
                    ? { applied: false, status: 'timeout' }
                    : { applied: true, status: 'applied' };
            }),
        });
        const eventRelay = createRenderSurfaceEventRelay({
            commandRelay: relay,
            documentRef: document,
            onImageCommand: cache.capture,
        });
        eventRelay.setup();

        dispatchVmControlMutation(document, {
            action: 'set-image',
            descriptor: { kind: 'image', path: 'avatar', source: 'view-model' },
            kind: 'image',
            value: [7, 8, 9],
        });
        await relay.whenIdle();
        expect(cache.replayForStage('replacement')).toEqual([]);

        await relay.flush();
        expect(cache.replayForStage('replacement')).toEqual([
            expect.objectContaining({ path: 'avatar', value: [7, 8, 9] }),
        ]);
        eventRelay.dispose();
    });

    it('namespaces the same image path by source, artboard, and bound ViewModel instance', () => {
        const cache = createRenderSurfaceImageReplayCache();
        activateSource(cache, 'a-one', 'file-a', 'Inspector', 'Artboard One');
        expect(acknowledge(cache, {
            action: 'set-image', kind: 'image', path: 'avatar', value: [1],
        }, 'a-one')).toBe(true);

        activateSource(cache, 'a-two', 'file-a', 'Inspector', 'Artboard Two');
        expect(acknowledge(cache, {
            action: 'set-image', kind: 'image', path: 'avatar', value: [2],
        }, 'a-two')).toBe(true);

        cache.beginStage('a-one-reopen');
        cache.setStagedSource('a-one-reopen', 'file-a', 'Inspector', 'Artboard One');
        expect(cache.replayForStage('a-one-reopen')).toEqual([
            expect.objectContaining({ path: 'avatar', value: [1] }),
        ]);

        cache.beginStage('a-two-reopen');
        cache.setStagedSource('a-two-reopen', 'file-a', 'Inspector', 'Artboard Two');
        expect(cache.replayForStage('a-two-reopen')).toEqual([
            expect.objectContaining({ path: 'avatar', value: [2] }),
        ]);

        cache.beginStage('other-instance');
        cache.setStagedSource('other-instance', 'file-a', 'Other', 'Artboard One');
        expect(cache.replayForStage('other-instance')).toEqual([]);
    });

    it('journals acknowledgements to the actual delivery session across a rejected activation barrier', () => {
        const cache = createRenderSurfaceImageReplayCache();
        activateSource(cache, 'a-active', 'file-a', null, 'A');

        cache.beginStage('b-stage');
        cache.setStagedSource('b-stage', 'file-b', null, 'B');
        const held = { action: 'set-image', kind: 'image', path: 'avatar', value: [9] };
        cache.capture(held, 'b-stage');
        cache.rejectStage('b-stage');

        // The barrier rejected B, so this held command is delivered back to A.
        expect(cache.resolveCommand({
            payload: held,
            result: { applied: true, status: 'applied' },
            targetSessionId: 'a-active',
        })).toBe(true);

        cache.beginStage('b-reopen');
        cache.setStagedSource('b-reopen', 'file-b', null, 'B');
        expect(cache.replayForStage('b-reopen')).toEqual([]);

        cache.beginStage('a-reopen');
        cache.setStagedSource('a-reopen', 'file-a', null, 'A');
        expect(cache.replayForStage('a-reopen')).toEqual([
            expect.objectContaining({ path: 'avatar', value: [9] }),
        ]);
    });

    it('evicts only a failed or corrupt replay entry and retains the other valid entries', () => {
        const cache = createRenderSurfaceImageReplayCache();
        activateSource(cache, 'active', 'file-a', null, 'A');
        acknowledge(cache, { action: 'set-image', kind: 'image', path: 'bad', value: [1] }, 'active');
        acknowledge(cache, { action: 'set-image', kind: 'image', path: 'good', value: [2] }, 'active');

        cache.beginStage('replacement');
        cache.setStagedSource('replacement', 'file-a', null, 'A');
        const plan = cache.planReplayForStage('replacement');
        const bad = plan.find((entry) => entry.payload.path === 'bad');
        const good = plan.find((entry) => entry.payload.path === 'good');
        expect(cache.recordReplayOutcome('replacement', bad, {
            applied: false, status: 'missing-property',
        })).toEqual(expect.objectContaining({
            path: 'bad', resultStatus: 'missing-property', status: 'evicted-failed-replay',
        }));
        expect(cache.validateReplayEntry('replacement', good)).toEqual(expect.objectContaining({ valid: true }));
        expect(cache.replayForStage('replacement')).toEqual([
            expect.objectContaining({ path: 'good', value: [2] }),
        ]);

        const corruptPlan = cache.planReplayForStage('replacement');
        corruptPlan[0].payload.path = '';
        expect(cache.validateReplayEntry('replacement', corruptPlan[0])).toEqual(expect.objectContaining({
            status: 'corrupt-entry', valid: false,
        }));
        expect(cache.replayForStage('replacement')).toEqual([]);
    });

    it('bounds entries, scopes, and bytes with LRU eviction and clears all retained state', () => {
        const outcomes = [];
        const cache = createRenderSurfaceImageReplayCache({
            maxEntries: 2,
            maxEntryBytes: 512,
            maxScopes: 2,
            maxTotalBytes: 700,
            onOutcome: (outcome) => outcomes.push(outcome),
        });
        activateSource(cache, 'a', 'file-a', null, 'A');
        acknowledge(cache, { action: 'set-image', kind: 'image', path: 'a', value: Array(180).fill(1) }, 'a');
        activateSource(cache, 'b', 'file-b', null, 'B');
        acknowledge(cache, { action: 'set-image', kind: 'image', path: 'b', value: Array(180).fill(2) }, 'b');
        activateSource(cache, 'c', 'file-c', null, 'C');
        acknowledge(cache, { action: 'set-image', kind: 'image', path: 'c', value: Array(180).fill(3) }, 'c');

        const state = cache.getState();
        expect(state.entryCount).toBeLessThanOrEqual(2);
        expect(state.scopeCount).toBeLessThanOrEqual(2);
        expect(state.totalBytes).toBeLessThanOrEqual(700);
        expect(outcomes.some((outcome) => outcome.status.startsWith('evicted-'))).toBe(true);

        const oversized = { action: 'set-image', kind: 'image', path: 'huge', value: Array(600).fill(4) };
        cache.capture(oversized, 'c');
        expect(cache.resolveCommand({
            payload: oversized,
            result: { applied: true, status: 'applied' },
            targetSessionId: 'c',
        })).toBe(false);
        expect(cache.getState().lastOutcome).toEqual(expect.objectContaining({ status: 'dropped-oversize' }));

        cache.clear();
        expect(cache.getState()).toEqual(expect.objectContaining({
            activeScope: null,
            entryCount: 0,
            provisionalCount: 0,
            scopeCount: 0,
            totalBytes: 0,
        }));
    });
});
