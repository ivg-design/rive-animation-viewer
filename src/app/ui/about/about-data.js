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
    { label: 'Rive Docs', url: 'https://rive.app/docs' },
    { label: 'Rive Community', url: 'https://community.rive.app' },
    { label: 'mograph.life', url: 'https://mograph.life' },
];

export function buildDependencyEntries(packageData = {}) {
    const merged = {
        ...(packageData.dependencies || {}),
        ...(packageData.devDependencies || {}),
    };
    return Object.entries(merged)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, version]) => ({ name, version }));
}
