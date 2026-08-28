function failure(message, result = null) {
    return { activated: false, message, result };
}

export async function prepareAndActivateRenderSurface({
    activate,
    flushPendingCommands,
    getControlSnapshot,
    getPresentationState,
    isCurrentSession = () => true,
    pendingCommandCount,
    playbackCommand = null,
    replayImageCommands = [],
    recordImageReplayOutcome = () => {},
    sealActivationBarrier = async () => true,
    sendCommand,
    validateImageReplayEntry = () => ({ valid: true }),
    waitForCanonicalBaseline = async () => ({ ready: true, status: 'ready' }),
} = {}) {
    let snapshot = [];
    try {
        snapshot = getControlSnapshot?.() || [];
    } catch {
        // Mutations queued while loading remain authoritative.
    }

    if (Array.isArray(snapshot) && snapshot.length) {
        const result = await sendCommand('snapshot', { snapshot });
        if (!result?.applied) {
            return failure(
                `Unable to prepare playback controls: ${result?.message || result?.status || 'unknown error'}`,
                result,
            );
        }
    }

    const imageReplay = { applied: 0, attempted: replayImageCommands.length, skipped: [] };
    for (const replayEntry of replayImageCommands) {
        let validation;
        try {
            validation = await validateImageReplayEntry(replayEntry);
        } catch (error) {
            validation = { message: error?.message || String(error), status: 'validation-error', valid: false };
        }
        if (validation?.valid === false) {
            imageReplay.skipped.push({
                entryId: replayEntry?.entryId ?? null,
                message: validation.message || null,
                path: replayEntry?.payload?.path || replayEntry?.path || '',
                status: validation.status || 'invalid-entry',
            });
            continue;
        }
        const imageCommand = replayEntry?.payload || replayEntry;
        let result;
        try {
            result = await sendCommand('vm-image-set', imageCommand);
        } catch (error) {
            result = {
                applied: false,
                message: error?.message || String(error || 'Image replay failed.'),
                status: 'transport-error',
            };
        }
        try { await recordImageReplayOutcome(replayEntry, result); } catch {}
        if (result?.applied) {
            imageReplay.applied += 1;
        } else {
            imageReplay.skipped.push({
                entryId: replayEntry?.entryId ?? null,
                message: result?.message || null,
                path: imageCommand?.path || imageCommand?.name || '',
                status: result?.status || 'rejected',
            });
        }
    }

    const presentationResult = await sendCommand('presentation', getPresentationState?.() || {});
    if (!presentationResult?.applied) {
        return failure(
            `Unable to prepare playback layout: ${presentationResult?.message || presentationResult?.status || 'unknown error'}`,
            presentationResult,
        );
    }

    if (playbackCommand?.type) {
        const playbackResult = await sendCommand(playbackCommand.type, playbackCommand.payload || {});
        if (!playbackResult?.applied) {
            return failure(
                `Unable to prepare playback state: ${playbackResult?.message || playbackResult?.status || 'unknown error'}`,
                playbackResult,
            );
        }
    }

    const flushResult = await flushPendingCommands();
    if (flushResult?.failed || pendingCommandCount() > 0) {
        return failure(
            flushResult?.message || 'Unable to replay pending controls on the prepared playback surface.',
            flushResult,
        );
    }

    // Applied editor onLoad code can mutate the Rive instance and therefore
    // the pixels that are about to become visible. Transfer callback authority
    // while the child is still staged, then include those mutations in the
    // same presentation fence as snapshots and layout state.
    if (!isCurrentSession()) {
        return failure('Playback surface activation was superseded before callbacks could run.');
    }
    const callbackActivation = await sendCommand('activate-callbacks');
    if (!callbackActivation?.applied) {
        return failure(
            `Unable to prepare applied editor callbacks: ${callbackActivation?.message || callbackActivation?.status || 'unknown error'}`,
            callbackActivation,
        );
    }

    const preparedFrame = await sendCommand('prepare-frame');
    if (!preparedFrame?.applied) {
        return failure(
            `Unable to confirm the prepared playback frame: ${preparedFrame?.message || preparedFrame?.status || 'unknown error'}`,
            preparedFrame,
        );
    }

    // A composited frame proves pixels, not inspector authority. The child
    // deliberately performs its potentially large ViewModel traversal after
    // the first frame fence. Keep the previous surface active until that full
    // canonical baseline has arrived, so UI and MCP can never observe an
    // activated session whose controls are still absent.
    const canonicalBaseline = await waitForCanonicalBaseline();
    if (canonicalBaseline?.ready !== true) {
        return failure(
            `Unable to confirm playback controls: ${canonicalBaseline?.message || canonicalBaseline?.status || 'unknown error'}`,
            canonicalBaseline,
        );
    }

    // Close the replacement mutation epoch only after the complete canonical
    // baseline exists. The coordinator drains every command accepted before
    // this seal to the candidate; commands arriving after it remain held until
    // native activation commits. This gives the final frame fence one stable,
    // acknowledged state to present.
    if (!isCurrentSession()) {
        return failure('Playback surface activation was superseded before its command barrier could seal.');
    }
    if (!await sealActivationBarrier()) {
        return failure('Unable to seal the playback surface activation barrier.');
    }

    // The deep canonical scan can occupy the child main thread. Cross a fresh
    // post-scan presentation fence before native reveal so activation cannot
    // expose the held pre-scan frame or a catch-up jump.
    const canonicalFrame = await sendCommand('prepare-frame');
    if (!canonicalFrame?.applied) {
        return failure(
            `Unable to confirm the canonical playback frame: ${canonicalFrame?.message || canonicalFrame?.status || 'unknown error'}`,
            canonicalFrame,
        );
    }

    if (!isCurrentSession()) {
        return failure('Playback surface activation was superseded before native reveal.');
    }
    if (!await activate()) {
        return failure('Unable to activate the prepared playback surface.');
    }
    return replayImageCommands.length
        ? { activated: true, imageReplay }
        : { activated: true };
}
