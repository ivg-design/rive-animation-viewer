import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const uiIndexPath = path.resolve('node_modules/@vitest/ui/dist/client/index.html');
const darkThemeNeedle = 'const setting = localStorage.getItem("vueuse-color-scheme") || "auto";';
const darkThemeReplacement = [
    'const existingSetting = localStorage.getItem("vueuse-color-scheme");',
    '        const setting = existingSetting || "dark";',
    '        if (!existingSetting) localStorage.setItem("vueuse-color-scheme", "dark");',
].join('\n');

const currentContent = readFileSync(uiIndexPath, 'utf8');

if (currentContent.includes('existingSetting') || currentContent.includes('|| "dark"')) {
    console.log(`Vitest UI dark theme is already prepared: ${uiIndexPath}`);
    process.exit(0);
}

if (!currentContent.includes(darkThemeNeedle)) {
    throw new Error(`Unable to locate Vitest UI theme bootstrap in ${uiIndexPath}`);
}

const nextContent = currentContent.replace(darkThemeNeedle, darkThemeReplacement);
writeFileSync(uiIndexPath, nextContent, 'utf8');

console.log(`Prepared Vitest UI dark theme bootstrap: ${uiIndexPath}`);
