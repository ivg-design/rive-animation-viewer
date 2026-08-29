import { readFileSync, promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { defineConfig } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkgPath = join(__dirname, 'package.json');
const { version } = JSON.parse(readFileSync(pkgPath, 'utf8'));
const appEntryPath = join(__dirname, 'src', 'app', 'main-entry.js').replace(/\\/g, '/');
const appJsUrl = '/src/app/main-entry.js';

function injectVersionPlugin() {
    const requestedChannel = String(process.env.APP_BUILD_CHANNEL || '').trim().toLowerCase();
    const channel = requestedChannel === 'release' ? 'release' : 'dev';
    const build = String(process.env.APP_BUILD_ID || 'dev-server');
    const injectBuildValues = (source) => source
        .replace(/__APP_VERSION__/g, version)
        .replace(/__APP_BUILD__/g, build)
        .replace(/__APP_CHANNEL__/g, channel);

    return {
        name: 'inject-version',
        transform(code, id) {
            const cleanId = id.split('?')[0];
            const normalizedId = cleanId.replace(/\\/g, '/');
            if (normalizedId !== appEntryPath) {
                return null;
            }
            return {
                code: injectBuildValues(code),
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
                    const transformed = injectBuildValues(source);
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
