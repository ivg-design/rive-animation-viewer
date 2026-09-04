import { readFile, writeFile } from 'node:fs/promises';
const source = new URL('../mcp-server/tools/media-tools.json', import.meta.url);
const tools = JSON.parse(await readFile(source, 'utf8'));
await writeFile(new URL('../mcp-server/tools/media-tools.js', import.meta.url),
    '// Generated from media-tools.json; used by Node MCP without JSON import-version requirements.\n'
    + 'export const MEDIA_TOOLS = [\n' + tools.map((tool) => `  ${JSON.stringify(tool)},`).join('\n') + '\n];\n');
