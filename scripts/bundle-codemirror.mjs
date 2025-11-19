#!/usr/bin/env node
import * as esbuild from 'esbuild';
import { promises as fs } from 'fs';

// Create a simple entry point that exports everything we need
const entryContent = `
export { basicSetup, EditorView } from 'codemirror';
export { javascript } from '@codemirror/lang-javascript';
export { oneDark } from '@codemirror/theme-one-dark';
export { keymap } from '@codemirror/view';
export { indentWithTab } from '@codemirror/commands';
`;

await fs.writeFile('codemirror-entry.js', entryContent);

// Bundle CodeMirror into a single file
await esbuild.build({
  entryPoints: ['codemirror-entry.js'],
  bundle: true,
  format: 'esm',
  outfile: 'vendor/codemirror-bundle.js',
  platform: 'browser',
  minify: false,
  sourcemap: false
});

// Clean up
await fs.unlink('codemirror-entry.js');

console.log('CodeMirror bundled to vendor/codemirror-bundle.js');