const MAX_PENDING_COMMANDS = 256;

function coalesceKey(type, payload = {}) {
    if (type === 'play' || type === 'pause') return 'playback';
    if (type !== 'vm-set' && type !== 'sm-set') return null;
    return type === 'sm-set'
        ? `${type}:${payload.stateMachineName || ''}:${payload.name || ''}:${payload.kind || ''}`
        : `${type}:${payload.path || ''}:${payload.kind || ''}`;
}

export function createRenderSurfaceCommandBuffer() {
    const entries = [];

    function enqueue(type, payload = {}) {
        const key = coalesceKey(type, payload);
        if (key) {
            const existing = entries.findIndex((entry) => entry.key === key);
            if (existing >= 0) entries.splice(existing, 1);
        }
        entries.push({ key, payload, type });
        if (entries.length > MAX_PENDING_COMMANDS) entries.shift();
    }

    return {
        clear: () => entries.splice(0),
        drain: () => entries.splice(0).map(({ payload, type }) => ({ payload, type })),
        enqueue,
        size: () => entries.length,
    };
}

export function createRenderSurfaceCommandRelay({ canSend, send } = {}) {
    const buffer = createRenderSurfaceCommandBuffer();

    function relay(type, payload = {}) {
        if (!canSend?.()) {
            buffer.enqueue(type, payload);
            return;
        }
        void send(type, payload).then((sent) => {
            if (!sent) buffer.enqueue(type, payload);
        });
    }

    async function flush() {
        const commands = buffer.drain();
        for (let index = 0; index < commands.length; index += 1) {
            const command = commands[index];
            if (!await send(command.type, command.payload)) {
                commands.slice(index).forEach((entry) => buffer.enqueue(entry.type, entry.payload));
                break;
            }
        }
    }

    return {
        clear: buffer.clear,
        flush,
        relay,
        size: buffer.size,
    };
}
