import {
    createRenderSurfaceCommandBuffer,
    createRenderSurfaceCommandRelay,
} from '../command-buffer.js';
import { createSessionSourceScopes } from './source-scopes.js';

function deferred() {
    let resolve;
    const promise = new Promise((next) => { resolve = next; });
    return { promise, resolve };
}

function shouldReplay(type) {
    return type !== 'eval' && type !== 'presentation' && type !== 'vm-image-set';
}

export function createRenderSurfaceActivationCoordinator({
    getActiveSessionId,
    getStagedSessionId,
    isSessionAddressable,
    onCommandResult = () => {},
    onOverflow = () => {},
    protocol,
} = {}) {
    let barrier = null;
    let stage = null;
    const directInFlight = new Set();
    const relayTargets = new WeakMap();
    const sourceScopes = createSessionSourceScopes({ getActiveSessionId, getStagedSessionId });

    function notifyStageResult({ payload, result, sessionId, type, metadata = {} }) {
        try { onCommandResult({ metadata: { stage: true, ...metadata }, payload, result, targetSessionId: sessionId, type }); } catch {}
    }

    function setStage(sessionId) {
        stage = {
            commands: createRenderSurfaceCommandBuffer({
                onSupersede: ({ payload, type }) => notifyStageResult({
                    metadata: { superseded: true },
                    payload,
                    result: { applied: false, status: 'superseded' },
                    sessionId,
                    type,
                }),
            }),
            sessionId,
        };
    }

    function installBarrier(sessionId, commandSessionId = sessionId) {
        if (barrier) {
            const previous = barrier;
            barrier = null;
            previous.routeGate.resolve(false);
            previous.gate.resolve(false);
        }
        const next = {
            commandSessionId,
            gate: deferred(),
            phase: 'draining',
            routeGate: deferred(),
            routeSessionId: null,
            sessionId,
        };
        barrier = next;
        return next;
    }

    function openBarrier(expected, routeSessionId) {
        if (!expected || barrier !== expected || expected.phase !== 'draining') return false;
        expected.phase = 'open';
        expected.routeSessionId = routeSessionId;
        expected.routeGate.resolve(true);
        return true;
    }

    function settleBarrier(expected, activated) {
        if (!expected || barrier !== expected) return false;
        // Clear before resolving. Any waiter resumed by the promise must never
        // observe the same already-resolved gate and spin in the microtask queue.
        barrier = null;
        expected.routeGate.resolve(Boolean(activated));
        expected.gate.resolve(Boolean(activated));
        return true;
    }

    function routedSessionId() {
        if (barrier) return barrier.phase === 'open' ? barrier.routeSessionId : null;
        return getActiveSessionId?.() || getStagedSessionId?.() || null;
    }

    function cancelStage({ message = 'Command cancelled.', status = 'cancelled' } = {}) {
        if (!stage) return 0;
        const pendingStage = stage;
        stage = null;
        const cancelled = pendingStage.commands.clear();
        cancelled.forEach(({ payload, type }) => notifyStageResult({
            metadata: { cancelled: true },
            payload,
            result: { applied: false, message, status },
            sessionId: pendingStage.sessionId,
            type,
        }));
        return cancelled.length;
    }

    function cancelBuffered({ message = 'Command cancelled.', status = 'cancelled' } = {}) {
        const relayCancelled = relay.clear({ message, status });
        const stageCancelled = cancelStage({ message, status });
        return relayCancelled + stageCancelled;
    }

    function recordAppliedStageCommand(targetSessionId, type, payload, result) {
        if (!result?.applied || !stage || targetSessionId !== getActiveSessionId?.() || !shouldReplay(type)) return;
        // The stage may not have a source yet during preflight; stamp now and
        // validate again at flush, after the independent context is resolved.
        sourceScopes.stamp(payload, targetSessionId);
        if (sourceScopes.get(stage.sessionId) && !sourceScopes.canReplay(targetSessionId, stage.sessionId)) return;
        if (!stage.commands.enqueue(type, payload)) onOverflow({ payload, status: 'overflow', type });
    }

    async function sendToSession(sessionId, type, payload = {}) {
        if (!sessionId || !isSessionAddressable?.(sessionId)) {
            return { applied: false, status: 'unavailable' };
        }
        if (!sourceScopes.matchesCommand(payload, sessionId)) return { applied: false, status: 'stale-source' };
        return protocol.requestCommand(type, payload, { targetSessionId: sessionId });
    }

    async function sendRouted(type, payload = {}, { targetSessionId: capturedTargetSessionId } = {}) {
        const targetSessionId = capturedTargetSessionId || routedSessionId();
        if (payload && typeof payload === 'object') relayTargets.set(payload, targetSessionId);
        const result = await sendToSession(targetSessionId, type, payload);
        recordAppliedStageCommand(targetSessionId, type, payload, result);
        return result;
    }

    async function waitForDirectCommands() {
        // A direct toolbar/MCP request does not travel through `relay`, so the
        // activation barrier must explicitly drain it before snapshot/replay.
        // Capture exactly the commands that predate this barrier. New direct
        // requests wait on the barrier and therefore cannot enter this set.
        // One extra checkpoint lets each request's `finally` remove its entry;
        // never poll a mutable Set from a self-sustaining microtask loop.
        const pending = [...directInFlight];
        if (!pending.length) return true;
        await Promise.allSettled(pending);
        await Promise.resolve();
        return pending.every((delivery) => !directInFlight.has(delivery));
    }

    const relay = createRenderSurfaceCommandRelay({
        canSend: () => Boolean(routedSessionId()),
        getTargetSessionId: routedSessionId,
        onResult: (delivery) => {
            const targetSessionId = delivery.payload && typeof delivery.payload === 'object'
                ? relayTargets.get(delivery.payload) ?? null
                : null;
            onCommandResult({ ...delivery, targetSessionId });
            if (!delivery.metadata?.requeued && delivery.payload && typeof delivery.payload === 'object') {
                relayTargets.delete(delivery.payload);
            }
        },
        onOverflow,
        send: sendRouted,
    });

    function beginStage(sessionId) {
        if (barrier) settleBarrier(barrier, false);
        setStage(sessionId);
    }

    async function prepareStage(sessionId) {
        if (!sessionId) return false;
        const predecessorSessionId = getActiveSessionId?.() || null;
        if (!predecessorSessionId) {
            beginStage(sessionId);
            return true;
        }

        // Freeze routing before the controller changes image-cache, protocol,
        // or native-WebView ownership. Commands already sent to the predecessor
        // must settle there; commands issued during this short fence are queued
        // with the predecessor as their image-cache identity.
        const preflightBarrier = installBarrier(sessionId, predecessorSessionId);
        await relay.whenIdle();
        const directSettled = await waitForDirectCommands();
        if (!directSettled || barrier !== preflightBarrier) {
            settleBarrier(preflightBarrier, false);
            return false;
        }

        setStage(sessionId);
        settleBarrier(preflightBarrier, true);

        // Deliver mutations that arrived during the fence to the still-active
        // predecessor before the caller changes session ownership. Retry one
        // explicitly retryable transport outcome; this remains bounded.
        let flushed = await relay.flush();
        if (flushed?.retryable) flushed = await relay.flush();
        if (flushed?.failed) {
            cancelBuffered({
                message: 'Playback surface preflight exhausted its command retry budget.',
                status: 'cancelled',
            });
            return false;
        }
        return true;
    }

    async function beginBarrier(sessionId) {
        if (!stage || stage.sessionId !== sessionId) return false;
        const activationBarrier = installBarrier(sessionId, sessionId);
        await relay.whenIdle();
        const directSettled = await waitForDirectCommands();
        if (!directSettled || barrier !== activationBarrier) {
            settleBarrier(activationBarrier, false);
            return false;
        }
        if (!openBarrier(activationBarrier, sessionId)) return false;

        // Relay mutations received while predecessor ACKs were draining were
        // intentionally buffered. Once B opens, deliver that bounded buffer
        // to B before the activation transaction may prepare its final frame.
        // A failed delivery receives one retry through `flush()` and then the
        // stage is rejected; it must never leak past reveal into a later file.
        let flushed = await relay.flush();
        if (flushed?.retryable) flushed = await relay.flush();
        if (flushed?.failed || barrier !== activationBarrier) {
            if (barrier === activationBarrier) {
                cancelBuffered({
                    message: 'Playback surface activation exhausted its command retry budget.',
                    status: 'cancelled',
                });
                settleBarrier(activationBarrier, false);
            }
            return false;
        }
        return true;
    }

    async function sealBarrier(sessionId) {
        const activationBarrier = barrier;
        if (!activationBarrier || activationBarrier.sessionId !== sessionId || activationBarrier.phase !== 'open') {
            return false;
        }
        // Seal synchronously before awaiting. Relay commands accepted while
        // open retain their candidate target; later commands stay buffered
        // until `endStage()` publishes (or rejects) that candidate.
        activationBarrier.phase = 'sealed';
        activationBarrier.routeSessionId = null;
        await relay.whenIdle();
        const directSettled = await waitForDirectCommands();
        return Boolean(directSettled && barrier === activationBarrier);
    }

    function finishBarrier(sessionId, activated) {
        if (barrier?.sessionId === sessionId) settleBarrier(barrier, activated);
    }

    async function flushStage(sessionId) {
        if (!stage || stage.sessionId !== sessionId) return { failed: false, outcomes: [] };
        const commands = stage.commands.drain();
        const outcomes = [];
        for (const command of commands) {
            if (!sourceScopes.matchesCommand(command.payload, sessionId)) {
                notifyStageResult({ ...command, sessionId, result: { applied: false, status: 'stale-source' } });
                continue;
            }
            const result = await sendToSession(sessionId, command.type, command.payload);
            outcomes.push(result);
            if (!result?.applied) {
                return { failed: true, message: result?.message || result?.status, outcomes };
            }
        }
        return { failed: false, outcomes };
    }

    async function requestCommand(type, payload = {}, { targetSessionId: capturedTargetSessionId } = {}) {
        sourceScopes.stamp(payload, capturedTargetSessionId || getActiveSessionId?.() || stage?.sessionId || getStagedSessionId?.());
        const observedBarrier = barrier;
        if (observedBarrier?.phase === 'draining') {
            await observedBarrier.routeGate.promise;
            // Back-to-back replacements can install a newer fence before this
            // continuation resumes. Reject once instead of walking a mutable
            // chain of gates in the microtask queue.
            if (barrier && barrier !== observedBarrier) {
                return { applied: false, status: 'replacement-busy' };
            }
        }
        const currentBarrier = barrier;
        if (currentBarrier?.phase === 'sealed') {
            await currentBarrier.gate.promise;
            if (barrier) return { applied: false, status: 'replacement-busy' };
        }
        // Register before awaiting so `beginBarrier()` cannot activate a
        // replacement while a successfully applied old-surface command is
        // still awaiting its acknowledgement and replay journal entry.
        const targetSessionId = capturedTargetSessionId || routedSessionId();
        const delivery = sendToSession(targetSessionId, type, payload);
        directInFlight.add(delivery);
        try {
            const result = await delivery;
            recordAppliedStageCommand(targetSessionId, type, payload, result);
            try { onCommandResult({ payload, result, targetSessionId, type }); } catch {}
            return result;
        } finally {
            directInFlight.delete(delivery);
        }
    }

    function endStage(sessionId, activated) {
        if (stage?.sessionId === sessionId) stage = null;
        finishBarrier(sessionId, activated);
    }

    return {
        beginBarrier,
        beginStage,
        clear() {
            cancelBuffered();
            sourceScopes.clear();
            if (barrier) settleBarrier(barrier, false);
        },
        endStage,
        flushQueued: relay.flush,
        flushStage,
        getCommandSessionId: () => barrier?.commandSessionId || routedSessionId(),
        pendingQueued: relay.size,
        pendingStage: () => stage?.commands.size() || 0,
        prepareStage,
        relay: { ...relay, relay(type, payload = {}) {
            sourceScopes.stamp(payload, getActiveSessionId?.() || stage?.sessionId || getStagedSessionId?.());
            return relay.relay(type, payload);
        } },
        getActiveSourceScope: sourceScopes.active,
        getSourceScope: sourceScopes.get,
        setSourceScope: sourceScopes.set,
        captureScopedSnapshot: sourceScopes.capture,
        canReplaySource: sourceScopes.canReplay,
        requestCommand,
        sealBarrier,
        sendToSession,
    };
}
