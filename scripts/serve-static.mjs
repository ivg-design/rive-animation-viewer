import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const [, , directoryArg = 'coverage', portArg = '4174', hostArg = '127.0.0.1'] = process.argv;
const rootDirectory = path.resolve(directoryArg);
const port = Number.parseInt(portArg, 10);
const host = hostArg;

const mimeTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
};

if (!existsSync(rootDirectory)) {
    throw new Error(`Static directory does not exist: ${rootDirectory}`);
}

const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, `http://${host}:${port}`).pathname);
    const normalizedPath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
    let filePath = path.join(rootDirectory, normalizedPath === '/' ? 'index.html' : normalizedPath);

    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
    }

    if (!existsSync(filePath)) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(`Not found: ${requestPath}`);
        return;
    }

    const mimeType = mimeTypes[path.extname(filePath)] ?? 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': mimeType });
    createReadStream(filePath).pipe(response);
});

server.listen(port, host, () => {
    console.log(`Serving ${rootDirectory} at http://${host}:${port}/`);
});
