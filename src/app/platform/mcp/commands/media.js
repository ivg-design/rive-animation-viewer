import { normalizeMediaRequest } from '../../media/request-validation.js';

export function createMediaCommands({ windowRef = globalThis.window } = {}) {
    function service() {
        const controller = windowRef?._mcpGetMediaExportController?.();
        if (!controller) throw new Error('Media export requires desktop RAV with a loaded render surface.');
        return controller;
    }
    const handlers = {
        rav_media_capabilities: (controller) => controller.capabilities(),
        rav_export_media: (controller, options) => controller.exportMedia(options),
        rav_record_start: (controller, options) => controller.startRecording(options),
        rav_record_stop: (controller) => controller.stopRecording(),
        rav_media_status: (controller, { job_id }) => controller.status(job_id),
        rav_media_cancel: (controller, { job_id }) => controller.cancel(job_id),
        rav_step_frames: (controller, options) => controller.stepFrames(options),
        rav_pointer: (controller, options) => controller.pointer(options),
    };
    return Object.fromEntries(Object.entries(handlers).map(([tool, handler]) => [tool, (args) => {
        const request = normalizeMediaRequest(tool, args);
        return handler(service(), request);
    }]));
}
