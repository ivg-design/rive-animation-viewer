export const capabilities = {
    formats: ['png', 'jpg', 'webp', 'h264', 'h265', 'webm', 'apng', 'gif'].map((id) => ({
        id, available: true, alpha: !['jpg', 'h264', 'h265'].includes(id),
    })),
    limits: { max_frames: 36000, max_pixels: 4194304, max_edge: 4096, max_duration_seconds: 300, max_fps: 60 },
    gif: { resolved_auto_encoder: 'ffmpeg', gifski_available: false, ffmpeg_available: true,
        motion_quality: false, lossy_quality: false, fps_max: 50, max_attempts: 5,
        size_policies: ['quality_only', 'quality_fps_scale'],
        balanced: { max_edge: 960, max_fps: 20, quality: 80 },
        small: { max_edge: 480, max_fps: 12, quality: 60 } },
};
export const timeline = { width: 1920, height: 1080, playback: { type: 'animation', fps: 60, durationSeconds: 4 } };
export const stateMachine = { ...timeline, playback: { type: 'stateMachine', fps: 60 } };
