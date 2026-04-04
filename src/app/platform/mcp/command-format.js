export function mcpLog(type, message, payload, windowRef = globalThis.window) {
    if (typeof windowRef?._mcpLogEvent === 'function') {
        windowRef._mcpLogEvent(type, message, payload);
    }
}

export function updateStatusIndicator(state, windowRef = globalThis.window) {
    if (typeof windowRef?._mcpUpdateStatus === 'function') {
        const normalizedState = typeof state === 'string'
            ? state
            : !state?.enabled
                ? 'off'
                : state?.connected
                    ? 'connected'
                    : 'waiting';
        windowRef._mcpUpdateStatus(normalizedState);
    }
}

export function formatCommandSummary(command, params) {
    const label = command.replace(/^rav_/, '').replace(/_/g, ' ');
    if (!params || Object.keys(params).length === 0) {
        return label;
    }

    const parts = Object.entries(params).map(([key, value]) => {
        if (typeof value === 'string' && value.length > 60) {
            return `${key}: "${value.slice(0, 57)}..."`;
        }
        if (typeof value === 'string') {
            return `${key}: "${value}"`;
        }
        return `${key}: ${JSON.stringify(value)}`;
    });

    return `${label}  ${parts.join(', ')}`;
}

export function formatResultSummary(command, result) {
    if (!result || typeof result !== 'object') {
        return String(result ?? 'ok');
    }
    if (command === 'rav_status') {
        const file = result.file?.name || 'none';
        const runtimeName = result.runtime?.name || '?';
        const runtimeVersion = result.runtime?.version || '?';
        const playing = result.playback?.isPlaying ? 'playing' : 'paused';
        const vmCount = result.viewModel?.pathCount || 0;
        return `${file} | ${runtimeName} ${runtimeVersion} | ${playing} | ${vmCount} VM paths`;
    }
    if (command === 'rav_get_vm_tree') {
        return `${result.paths?.length || 0} paths, ${result.inputs?.length || 0} inputs`;
    }
    if (command === 'rav_vm_get') {
        return `${result.path} = ${JSON.stringify(result.value)}`;
    }
    if (command === 'rav_vm_set') {
        return `${result.path} ← ${JSON.stringify(result.value)}`;
    }
    if (command === 'rav_open_file' && result.file) {
        const size = result.sizeBytes ? ` (${(result.sizeBytes / 1024).toFixed(1)} KB)` : '';
        return `Opened ${result.file}${size}`;
    }
    if (command === 'rav_get_event_log') {
        return `${result.returned}/${result.total} events`;
    }
    if (command === 'rav_get_sm_inputs') {
        return `${result.inputs?.length || 0} inputs`;
    }
    if (result.artboards) {
        return result.artboards.join(', ') || 'none';
    }
    if (result.stateMachines) {
        return result.stateMachines.join(', ') || 'none';
    }
    if (command === 'rav_get_editor_code' && result.code !== undefined) {
        return `${result.code.split('\n').length} lines`;
    }
    if (result.ok) {
        return 'ok';
    }
    if (command === 'rav_eval' && result.result !== undefined) {
        const formatted = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
        return formatted.length > 80 ? `${formatted.slice(0, 77)}...` : formatted;
    }
    return 'ok';
}
