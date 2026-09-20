import { readFile, writeFile } from 'node:fs/promises';
const source = new URL('../mcp-server/tools/entitlement-tools.json', import.meta.url);
const tools = JSON.parse(await readFile(source, 'utf8'));
await writeFile(new URL('../mcp-server/tools/entitlement-tools.js', import.meta.url),
    '// Generated from entitlement-tools.json; used by Node MCP without JSON import-version requirements.\n'
    + 'export const ENTITLEMENT_TOOLS = [\n' + tools.map((tool) => `  ${JSON.stringify(tool)},`).join('\n') + '\n];\n');
