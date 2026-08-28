import { getTauriInvoker } from '../bridge-port.js';

export function createMcpOpenFileCommand(windowRef = globalThis.window) {
    return async function ravOpenFile({ path }) {
        if (!path) throw new Error('path is required');
        const invoke = getTauriInvoker(windowRef);
        if (!invoke) {
            throw new Error(
                'File opening requires the Tauri desktop app. In the browser, drag and drop a .riv file onto the canvas instead.',
            );
        }
        const base64 = await invoke('read_riv_file', { path });
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        const buffer = bytes.buffer;
        const blob = new Blob([buffer], { type: 'application/octet-stream' });
        const fileUrl = URL.createObjectURL(blob);
        const fileName = path.split('/').pop() || path.split('\\').pop() || 'unknown.riv';

        let fileTransaction = null;
        try {
            if (typeof windowRef._mcpStageCurrentFile !== 'function') throw new Error('Transactional file bridge is unavailable');
            if (typeof windowRef._mcpLoadAnimation !== 'function') throw new Error('Animation loader bridge is unavailable');
            fileTransaction = windowRef._mcpStageCurrentFile(
                fileUrl, fileName, true, buffer, blob.type, buffer.byteLength, { sourcePath: path },
            );
            await windowRef._mcpLoadAnimation(fileUrl, fileName, {
                forceAutoplay: true,
                waitForActivation: true,
            });
            fileTransaction?.commit?.();
            return { ok: true, file: fileName, sizeBytes: buffer.byteLength };
        } catch (error) {
            if (fileTransaction) fileTransaction.rollback?.();
            else URL.revokeObjectURL(fileUrl);
            throw error;
        }
    };
}
