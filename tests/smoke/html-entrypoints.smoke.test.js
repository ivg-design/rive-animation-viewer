import fs from 'node:fs/promises';
import path from 'node:path';

describe('html entrypoints', () => {
    it('loads a single app entry module from src/app', async () => {
        const htmlPath = path.resolve('index.html');
        const html = await fs.readFile(htmlPath, 'utf8');

        expect(html).toContain('<script type="module" src="src/app/main-entry.js"></script>');
        expect(html).not.toContain('<script type="module" src="app.js"></script>');
        expect(html).not.toContain('<script type="module" src="mcp-bridge.js"></script>');
        expect(html).not.toContain('<script src="mcp-bridge.js" defer></script>');
    });
});
