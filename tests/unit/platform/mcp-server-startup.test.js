import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SERVER_DIR = resolve('mcp-server');

function serverModules() {
    const top = readdirSync(SERVER_DIR).filter((name) => name.endsWith('.js'));
    const tools = readdirSync(resolve(SERVER_DIR, 'tools'))
        .filter((name) => name.endsWith('.js'))
        .map((name) => `tools/${name}`);
    return [...top, ...tools];
}

describe('legacy Node MCP server startup', () => {
    // The server entry and its modules were unparseable for several releases
    // (an unescaped backtick inside SERVER_INSTRUCTIONS) without any test noticing.
    it.each(serverModules())('%s parses', (file) => {
        expect(() => execFileSync(process.execPath, ['--check', resolve(SERVER_DIR, file)], {
            stdio: 'pipe',
        })).not.toThrow();
    });

    it('exports the server instructions with literal inline-code spans', async () => {
        const { SERVER_INSTRUCTIONS } = await import('../../../mcp-server/instructions.js');
        expect(typeof SERVER_INSTRUCTIONS).toBe('string');
        expect(SERVER_INSTRUCTIONS).toContain('Do not invent placeholder globals like `FILE`, `FILE_PATH`');
    });
});
