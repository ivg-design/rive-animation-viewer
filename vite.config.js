import { readFileSync, promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { defineConfig } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkgPath = join(__dirname, 'package.json');
const { version } = JSON.parse(readFileSync(pkgPath, 'utf8'));
const appEntryPath = join(__dirname, 'app.js').replace(/\\/g, '/');
const appJsUrl = '/app.js';

function injectVersionPlugin() {
    return {
        name: 'inject-version',
        transform(code, id) {
            const cleanId = id.split('?')[0];
            const normalizedId = cleanId.replace(/\\/g, '/');
            if (normalizedId !== appEntryPath) {
                return null;
            }
            return {
                code: code.replace(/__APP_VERSION__/g, version),
                map: null,
            };
        },
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                const urlPath = req.url?.split('?')[0];
                if (urlPath !== appJsUrl) {
                    return next();
                }
                try {
                    const source = await fs.readFile(appEntryPath, 'utf8');
                    const transformed = source.replace(/__APP_VERSION__/g, version);
                    res.setHeader('Content-Type', 'application/javascript');
                    res.end(transformed);
                    return;
                } catch (error) {
                    server.config.logger.error(`[inject-version] ${error.message}`);
                    return next();
                }
            });
        },
    };
}

export default defineConfig({
    plugins: [injectVersionPlugin()],
    optimizeDeps: {
        exclude: ['codemirror', '@codemirror/lang-javascript', '@codemirror/theme-one-dark']
    }
});
