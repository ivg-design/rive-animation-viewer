import { prepareAndActivateRenderSurface } from '../activation/transaction.js';
import { setRenderSurfaceFpsState } from '../fps-indicator.js';
import { RENDER_SURFACE_PROTOCOL_VERSION } from '../protocol.js';

export function createRenderSurfaceActivationHandler({
    activationCoordinator,
    autoplayPolicy,
    boundsSync,
    canReveal,
    documentRef,
    eventRelay,
    fatalRecovery,
    getControlSnapshot,
    imageReplayCache,
    invokeQuietly,
    loadTracker,
    logEvent,
    protocol,
    publishAuthorityState,
    rejectStagedSession,
    sessionState,
    syncNativeVisibility,
    updateInfo,
}) {
    return async function handleChildLoaded(event) {
        if (sessionState.isDisposed() || !protocol.matches(event) || event?.payload?.command) {
            return true;
        }
        // Native custom-protocol delivery can overtake the JS ready event. A
        // loaded receipt carries the same version advertisement, so adopt it
        // before choosing the legacy/v2 activation contract. Otherwise a v2
        // child can be revealed without an ACK or canonical controls baseline.
        const advertisedProtocolVersion = Number(
            event?.payload?.protocolVersion ?? event?.payload?.protocol,
        );
        if (Number.isFinite(advertisedProtocolVersion) && advertisedProtocolVersion > 0) {
            protocol.handleReady(event);
        }
        if (protocol.getState().childProtocolVersion >= RENDER_SURFACE_PROTOCOL_VERSION
            && event?.payload?.firstFrame !== true) {
            // A non-first-frame startup receipt must remain unclaimed so the
            // later presentation receipt for this exact session can activate.
            return false;
        }
        const sessionId = event.payload.sessionId;
        if (sessionId === sessionState.getActiveSessionId()) return true;
        return sessionState.runActivationTransaction(sessionId, async () => {
            if (sessionState.isDisposed() || sessionState.isRejectingSession(sessionId)
                || !protocol.matches(event) || !sessionState.isCurrentSession(sessionId)) return true;
            const previousActiveSessionId = sessionState.getActiveSessionId();
            sessionState.setActivatingSessionId(sessionId);
            try {
                if (event?.payload?.binding?.requested && !event?.payload?.binding?.applied) {
                    const key = String(event.payload.binding.key || 'requested');
                    await rejectStagedSession(sessionId, {
                        error: `Unable to bind ViewModel instance "${key}" in the playback surface.`,
                        logName: 'render-surface-binding-rejected',
                        logText: `The visible renderer could not bind ViewModel instance ${key}.`,
                    });
                    return true;
                }
                loadTracker.clearTimeout();
                sessionState.setStagedReady(true);
                const replacingActiveSurface = Boolean(sessionState.getActiveSessionId());
                if (replacingActiveSurface && !await activationCoordinator.beginBarrier(sessionId)) {
                    await rejectStagedSession(sessionId, {
                        error: 'Playback surface activation could not settle the active control transaction.',
                        logName: 'render-surface-activation-barrier-rejected',
                        logText: 'The staged renderer was rejected because its activation fence did not settle.',
                    });
                    return true;
                }
                const pendingPresentationState = eventRelay.getPresentationState();
                const activePlayback = protocol.getState().canonicalState?.playback;
                const playbackCommand = autoplayPolicy.resolveReplacementCommand(
                    sessionId, activePlayback, replacingActiveSurface
                        && activationCoordinator.canReplaySource(previousActiveSessionId, sessionId),
                );
                const transaction = await prepareAndActivateRenderSurface({
                    // Bind the visibility decision to native activation. A settings
                    // popover/dialog already open at this point must not be covered
                    // by the candidate for even one native compositor frame.
                    activate: async () => {
                        if (!sessionState.isCurrentSession(sessionId)) return false;
                        // A staged render child is newer than an already-open
                        // bounded UI child. Recreate and await the overlay above
                        // that candidate before the candidate can be revealed.
                        // If no overlay is open this is an immediate no-op.
                        if (!await invokeQuietly('restack_ui_overlay')) return false;
                        if (!sessionState.isCurrentSession(sessionId)) return false;
                        return invokeQuietly('activate_render_surface', { reveal: canReveal(), sessionId });
                    },
                    flushPendingCommands: replacingActiveSurface
                        ? () => activationCoordinator.flushStage(sessionId)
                        : activationCoordinator.flushQueued,
                    getControlSnapshot: () => activationCoordinator.captureScopedSnapshot(getControlSnapshot),
                    targetScope: activationCoordinator.getSourceScope(sessionId),
                    getPresentationState: () => pendingPresentationState,
                    isCurrentSession: () => sessionState.isCurrentSession(sessionId),
                    pendingCommandCount: replacingActiveSurface
                        ? activationCoordinator.pendingStage
                        : activationCoordinator.pendingQueued,
                    playbackCommand,
                    recordImageReplayOutcome: (entry, result) => imageReplayCache.recordReplayOutcome(
                        sessionId, entry, result,
                    ),
                    replayImageCommands: imageReplayCache.planReplayForStage(sessionId),
                    sealActivationBarrier: replacingActiveSurface
                        ? () => activationCoordinator.sealBarrier(sessionId)
                        : async () => true,
                    sendCommand: (type, payload) => activationCoordinator.sendToSession(sessionId, type, payload),
                    validateImageReplayEntry: (entry) => imageReplayCache.validateReplayEntry(sessionId, entry),
                    waitForCanonicalBaseline: () => protocol.waitForCanonicalBaseline(sessionId),
                });
                if (!transaction.activated) {
                    await rejectStagedSession(sessionId, { error: transaction.message });
                    return true;
                }
                if (sessionState.isDisposed()) {
                    imageReplayCache.rejectStage(sessionId);
                    activationCoordinator.endStage(sessionId, false);
                    loadTracker.settle(sessionId, false);
                    return true;
                }
                const identityCurrent = sessionState.isCurrentSession(sessionId);
                const protocolActivated = identityCurrent && protocol.activateSession(sessionId);
                const imageScopeCommitted = protocolActivated && imageReplayCache.commitStage(sessionId);
                if (!protocolActivated || !imageScopeCommitted) {
                    // Native activation is already committed at this point. Never
                    // advertise an unrelated predecessor/candidate as healthy.
                    const reason = !protocolActivated
                        ? 'Playback surface activated without canonical command authority.'
                        : 'Playback surface activated without its image replay identity.';
                    sessionState.setActiveSessionId(sessionId);
                    sessionState.setSurfaceIdentity(sessionId);
                    sessionState.setLoaded(false);
                    autoplayPolicy.forget(sessionId);
                    if (!imageScopeCommitted) imageReplayCache.rejectStage(sessionId);
                    protocol.quarantineSession(sessionId, reason);
                    activationCoordinator.endStage(sessionId, false);
                    loadTracker.settle(sessionId, false);
                    publishAuthorityState();
                    setRenderSurfaceFpsState(documentRef, false);
                    void fatalRecovery.handleActiveFailure(sessionId, reason);
                    return true;
                }
                sessionState.setActiveSessionId(sessionId);
                autoplayPolicy.forget(sessionId);
                // Serialization guarantees no newer stage can replace this
                // identity until the native commit and JS authority converge.
                sessionState.setSurfaceIdentity(sessionId);
                protocol.beginSession(sessionId, RENDER_SURFACE_PROTOCOL_VERSION);
                activationCoordinator.endStage(sessionId, true);
                fatalRecovery.confirmReplacement(sessionId);
                sessionState.setLoaded(true);
                publishAuthorityState();
                setRenderSurfaceFpsState(documentRef, true);
                await boundsSync.sync({ force: true });
                const shown = await syncNativeVisibility();
                void activationCoordinator.flushQueued();
                loadTracker.settle(sessionId, true);
                const skippedImageCount = transaction.imageReplay?.skipped?.length || 0;
                if (skippedImageCount) {
                    transaction.imageReplay.skipped.forEach((outcome) => {
                        logEvent(
                            'native',
                            'render-surface-image-replay-skipped',
                            `Skipped cached image${outcome.path ? ` for ${outcome.path}` : ''}: ${outcome.status}.`,
                            outcome,
                        );
                    });
                }
                if (shown) {
                    logEvent('native', 'render-surface-loaded', 'Isolated render surface is active.');
                    updateInfo(skippedImageCount
                        ? `Isolated render surface active; ${skippedImageCount} stale image override${skippedImageCount === 1 ? '' : 's'} skipped.`
                        : 'Isolated render surface active.');
                }
                return true;
            } finally {
                sessionState.clearActivatingSessionId(sessionId);
            }
        });
    };
}
