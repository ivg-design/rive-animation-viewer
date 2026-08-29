const MAX_PENDING_COMMANDS = 256;

function coalesceKey(type, payload = {}) {
    if (type === 'play' || type === 'pause') return 'playback';
    if (type === 'presentation') return 'presentation';
    if (type === 'reset') return 'reset';
    if (type === 'vm-image-set') return `${type}:${payload.source || 'view-model'}:${payload.globalViewModelName || ''}:${payload.path || ''}`;
    if (type !== 'vm-set' && type !== 'sm-set') return null;
    return type === 'sm-set'
        ? `${type}:${payload.stateMachineName || ''}:${payload.name || ''}:${payload.kind || ''}`
        : `${type}:${payload.source || 'view-model'}:${payload.globalViewModelName || ''}:${payload.path || ''}:${payload.kind || ''}`;
}

export function createRenderSurfaceCommandBuffer({ onSupersede = () => {} } = {}) {
    const entries = [];

    function enqueue(type, payload = {}) {
        const key = coalesceKey(type, payload);
        if (key) {
            const existing = entries.findIndex((entry) => entry.key === key);
            if (existing >= 0) {
                const [superseded] = entries.splice(existing, 1);
                onSupersede(superseded);
            }
        }
        if (entries.length >= MAX_PENDING_COMMANDS) {
            return false;
        }
        entries.push({ key, payload, type });
        return true;
    }

    return {
        clear: () => entries.splice(0),
        drain: () => entries.splice(0).map(({ payload, type }) => ({ payload, type })),
        enqueue,
        size: () => entries.length,
    };
}

export function createRenderSurfaceCommandRelay({
    canSend,
    getTargetSessionId = null,
    onOverflow = () => {},
    onResult = () => {},
    send,
} = {}) {
    let deliveryTail = Promise.resolve();

    function notifyResult(type, payload, result, metadata = {}) {
        try {
            onResult({ metadata, payload, result, type });
        } catch {
            // A result observer must never break the ordered command lane.
        }
    }

    const buffer = createRenderSurfaceCommandBuffer({
        onSupersede: ({ payload, type }) => notifyResult(type, payload, {
            applied: false,
            status: 'superseded',
        }, { superseded: true }),
    });

    function enqueue(type, payload) {
        const accepted = buffer.enqueue(type, payload);
        if (!accepted) {
            const outcome = { delivered: false, retryable: false, status: 'overflow' };
            onOverflow({ ...outcome, payload, type });
            notifyResult(type, payload, { applied: false, ...outcome });
            return outcome;
        }
        return { delivered: false, queued: true, retryable: true, status: 'queued' };
    }

    function captureTargetSessionId() {
        return typeof getTargetSessionId === 'function' ? getTargetSessionId() : undefined;
    }

    function deliver(type, payload = {}, { requeue = true, targetSessionId = captureTargetSessionId() } = {}) {
        const delivery = deliveryTail.then(async () => {
            // A routed relay captures its session identity at the instant the
            // command is accepted. A later activation fence must drain that
            // fixed delivery snapshot, not retarget it to another WebView.
            const hasCapturedTarget = typeof getTargetSessionId === 'function';
            if (hasCapturedTarget ? !targetSessionId : !canSend?.()) {
                return enqueue(type, payload);
            }
            let result;
            try {
                result = await send(type, payload, { targetSessionId });
            } catch (error) {
                notifyResult(type, payload, {
                    applied: false,
                    error,
                    message: error?.message || String(error || 'Command delivery failed.'),
                    status: 'transport-error',
                });
                throw error;
            }
            const delivered = result === true || result?.applied === true;
            const status = result?.status || (delivered ? 'applied' : 'transport-error');
            // A timeout is an ambiguous delivery outcome. Retrying a trigger
            // can fire it twice when the child applied it but its ACK was
            // delayed or lost. Buffered triggers are still delivered once the
            // child becomes available; only an already-attempted ambiguous
            // trigger is terminal.
            const ambiguousTrigger = (type === 'vm-fire' || type === 'sm-fire')
                && (status === 'timeout' || status === 'transport-error');
            const retryable = !delivered
                && !ambiguousTrigger
                && ['cancelled', 'timeout', 'transport-error', 'unavailable'].includes(status);
            const requeued = retryable && requeue
                ? enqueue(type, payload).queued === true
                : false;
            notifyResult(type, payload, result, { requeued, retryable });
            return { delivered, result, retryable, status };
        });
        // A rejected transport must not poison later commands. The individual
        // delivery still rejects to its caller while the ordered lane recovers.
        deliveryTail = delivery.catch(() => false);
        return delivery;
    }

    function relay(type, payload = {}) {
        const targetSessionId = captureTargetSessionId();
        const hasCapturedTarget = typeof getTargetSessionId === 'function';
        if (hasCapturedTarget ? !targetSessionId : !canSend?.()) {
            return Promise.resolve(enqueue(type, payload));
        }
        return deliver(type, payload, { targetSessionId });
    }

    async function flush() {
        await deliveryTail;
        const commands = buffer.drain();
        const outcomes = [];
        for (let index = 0; index < commands.length; index += 1) {
            const command = commands[index];
            const outcome = await deliver(command.type, command.payload, { requeue: false });
            outcomes.push(outcome);
            if (!outcome.delivered && outcome.retryable) {
                commands.slice(index).forEach((entry) => enqueue(entry.type, entry.payload));
                break;
            }
        }
        const failedOutcome = outcomes.find((outcome) => !outcome.delivered);
        return {
            failed: Boolean(failedOutcome),
            message: failedOutcome?.result?.message || failedOutcome?.status || null,
            outcomes,
            retryable: Boolean(failedOutcome?.retryable),
        };
    }

    return {
        clear({ message = 'Command cancelled.', status = 'cancelled' } = {}) {
            const cancelled = buffer.clear();
            cancelled.forEach(({ payload, type }) => notifyResult(type, payload, {
                applied: false,
                message,
                status,
            }, { cancelled: true }));
            return cancelled.length;
        },
        flush,
        relay,
        size: buffer.size,
        whenIdle: () => deliveryTail,
    };
}
