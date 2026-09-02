import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SOURCE_DIR = path.join(ROOT, 'src/app/snippets/source');
const GENERATED_DIR = path.join(ROOT, 'src/app/snippets/generated');

function escapeTemplateLiteral(source) {
    return source
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\$\{/g, '\\${');
}

function extractBraceBlock(source, marker) {
    const startIndex = source.indexOf(marker);
    if (startIndex === -1) {
        throw new Error(`Could not find marker: ${marker}`);
    }
    const braceStart = source.indexOf('{', startIndex);
    if (braceStart === -1) {
        throw new Error(`Could not find opening brace for marker: ${marker}`);
    }

    let depth = 0;
    let stringQuote = null;
    let inTemplate = false;
    let inSingleLineComment = false;
    let inMultiLineComment = false;

    for (let index = braceStart; index < source.length; index += 1) {
        const char = source[index];
        const next = source[index + 1];
        const prev = source[index - 1];

        if (inSingleLineComment) {
            if (char === '\n') inSingleLineComment = false;
            continue;
        }
        if (inMultiLineComment) {
            if (prev === '*' && char === '/') inMultiLineComment = false;
            continue;
        }
        if (stringQuote) {
            if (char === stringQuote && prev !== '\\') stringQuote = null;
            continue;
        }
        if (inTemplate) {
            if (char === '`' && prev !== '\\') inTemplate = false;
            continue;
        }
        if (char === '/' && next === '/') {
            inSingleLineComment = true;
            continue;
        }
        if (char === '/' && next === '*') {
            inMultiLineComment = true;
            continue;
        }
        if (char === '"' || char === '\'') {
            stringQuote = char;
            continue;
        }
        if (char === '`') {
            inTemplate = true;
            continue;
        }

        if (char === '{') depth += 1;
        if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(startIndex, index + 1);
            }
        }
    }

    throw new Error(`Unclosed brace block for marker: ${marker}`);
}

async function writeModule(filePath, content) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    let lineEnding = '\n';
    try {
        if ((await fs.readFile(filePath, 'utf8')).includes('\r\n')) lineEnding = '\r\n';
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const normalized = content
        .trimEnd()
        .replace(/\r\n?/g, '\n')
        .replace(/\n/g, lineEnding);
    await fs.writeFile(filePath, `${normalized}${lineEnding}`, 'utf8');
}

async function main() {
    const defaultEditorSource = await fs.readFile(path.join(SOURCE_DIR, 'default-editor.js'), 'utf8');
    const vmExplorerSource = await fs.readFile(path.join(SOURCE_DIR, 'vm-explorer.js'), 'utf8');
    const runtimeCompatibilitySource = await fs.readFile(path.join(SOURCE_DIR, 'rive-runtime-compatibility.js'), 'utf8');

    const defaultEditorOnLoad = extractBraceBlock(defaultEditorSource, 'onLoad: () => {');
    const vmExplorerOnLoad = extractBraceBlock(vmExplorerSource, 'onLoad: () => {');
    const editorDefaultsModule = `
export const DEFAULT_EDITOR_CODE = \`${escapeTemplateLiteral(defaultEditorSource.trim())}\`;
export const DEFAULT_EDITOR_ONLOAD_BLOCK = \`${escapeTemplateLiteral(defaultEditorOnLoad.trim())}\`;
`;
    const vmExplorerModule = `
export const VM_EXPLORER_CODE = \`${escapeTemplateLiteral(vmExplorerSource.trim())}\`;
export const VM_EXPLORER_ONLOAD_BLOCK = \`${escapeTemplateLiteral(vmExplorerOnLoad.trim())}\`;
`;
    await writeModule(path.join(GENERATED_DIR, 'editor-defaults.generated.js'), editorDefaultsModule);
    await writeModule(path.join(GENERATED_DIR, 'vm-explorer.generated.js'), vmExplorerModule);
    await writeModule(
        path.join(GENERATED_DIR, 'rive-runtime-compatibility.generated.js'),
        `${runtimeCompatibilitySource.trim()}\n\nexport { createRiveRuntimeCompatibility };`,
    );
}

main().catch((error) => {
    console.error('[generate-snippet-modules] failed:', error);
    process.exit(1);
});
