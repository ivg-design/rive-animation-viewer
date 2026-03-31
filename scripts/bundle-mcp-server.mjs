#!/usr/bin/env node
/**
 * Bundle the MCP server + all dependencies into a single .js file.
 * Output: src-tauri/resources/rav-mcp-server.js
 * No npm install needed at runtime — just `node rav-mcp-server.js`.
 */
import { build } from 'esbuild';
import { mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

const root = process.cwd();
const mcpDir = path.join(root, 'mcp-server');
const outDir = path.join(root, 'src-tauri', 'resources');
mkdirSync(outDir, { recursive: true });

// Ensure MCP server dependencies are installed
if (!existsSync(path.join(mcpDir, 'node_modules'))) {
  console.log('Installing MCP server dependencies...');
  execSync('npm install --production', { cwd: mcpDir, stdio: 'inherit' });
}

await build({
  entryPoints: [path.join(root, 'mcp-server', 'index.js')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile: path.join(outDir, 'rav-mcp-server.js'),
  banner: { js: '#!/usr/bin/env node' },
  minify: false,
  sourcemap: false,
  external: [],
});

console.log('Bundled MCP server to src-tauri/resources/rav-mcp-server.js');
