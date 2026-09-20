export const ABOUT_APP_NAME = 'Rive Animation Viewer';
export const ABOUT_LICENSE = 'MIT';

export const ABOUT_CREDITS = [
    { label: 'Created by', value: 'IVG Design' },
    { label: 'Animation runtime', value: 'Rive Web Runtime' },
    { label: 'Desktop shell', value: 'Tauri' },
    { label: 'Editor', value: 'CodeMirror 6' },
    { label: 'Console inspector', value: 'Eruda' },
    { label: 'Icons', value: 'Lucide' },
];

export const ABOUT_LINKS = [
    { label: 'Documentation', url: 'https://forge.mograph.life/apps/rav/docs' },
    { label: 'RAV Site', url: 'https://forge.mograph.life/apps/rav' },
    { label: 'GitHub', url: 'https://github.com/ivg-design/rive-animation-viewer' },
    { label: 'Privacy Policy', url: 'https://forge.mograph.life/apps/rav/privacy' },
    { label: 'Rive Docs', url: 'https://rive.app/docs' },
    { label: 'Rive Community', url: 'https://community.rive.app' },
    { label: 'mograph.life', url: 'https://mograph.life' },
];

export function buildDependencyEntries(packageData = {}, additionalEntries = []) {
    const merged = {
        ...(packageData.dependencies || {}),
        ...(packageData.devDependencies || {}),
    };
    (Array.isArray(additionalEntries) ? additionalEntries : []).forEach((entry) => {
        const name = String(entry?.name || '').trim();
        if (name) merged[name] = normalizeDependencyVersion(entry?.version);
    });
    return Object.entries(merged)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, version]) => ({ name, version }));
}

// Encoder probes report their whole banner ("ffmpeg version 7.1.4-Jellyfin
// Copyright ..."); keep only the version token so the grid stays aligned.
export function normalizeDependencyVersion(version) {
    const text = String(version || 'available').trim();
    const match = text.match(/\bversion\s+(\S+)/i);
    return match ? match[1] : text;
}
