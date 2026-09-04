import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatToolResult } from '../../../mcp-server/tool-result.js';
import { TOOLS } from '../../../mcp-server/tools/index.js';

const NEW_TOOL_NAMES = [
    'rav_get_global_vm_tree',
    'rav_global_vm_get',
    'rav_global_vm_set',
    'rav_global_vm_fire',
    'rav_global_vm_set_image',
    'rav_global_vm_clear_image',
    'rav_capture_canvas',
];

function nativeToolNames() {
    const files = [
        'src-tauri/src/bin/rav-mcp/tool_registry.rs',
        'src-tauri/src/bin/rav-mcp/vm_tool_registry.rs',
        'mcp-server/tools/media-tools.json',
    ];
    return files.flatMap((file) => [
        ...readFileSync(resolve(file), 'utf8').matchAll(/"name":\s*"([^"]+)"/g),
    ].map((match) => match[1]));
}

describe('legacy MCP server registry', () => {
    it('matches all 57 unique native tools and advertises globals plus canvas capture', () => {
        const names = TOOLS.map((tool) => tool.name);
        const nativeNames = nativeToolNames();
        const captureTools = TOOLS.filter((tool) => tool.name === 'rav_capture_canvas');

        expect(names).toHaveLength(57);
        expect(new Set(names).size).toBe(57);
        expect(new Set(nativeNames).size).toBe(57);
        expect([...names].sort()).toEqual([...nativeNames].sort());
        expect(names).toEqual(expect.arrayContaining(NEW_TOOL_NAMES));
        expect(captureTools).toHaveLength(1);
        expect(captureTools[0].inputSchema).toEqual({
            additionalProperties: false,
            properties: {},
            type: 'object',
        });
    });

    it('returns capture data as MCP image content instead of JSON text', () => {
        expect(formatToolResult('rav_capture_canvas', {
            image: { data: 'iVBORw0KGgo=', mimeType: 'image/png' },
            metadata: { captureSurface: 'isolated-render-surface', width: 320 },
        })).toEqual({
            content: [
                {
                    text: JSON.stringify({
                        metadata: { captureSurface: 'isolated-render-surface', width: 320 },
                    }, null, 2),
                    type: 'text',
                },
                { data: 'iVBORw0KGgo=', mimeType: 'image/png', type: 'image' },
            ],
            structuredContent: {
                metadata: { captureSurface: 'isolated-render-surface', width: 320 },
            },
        });
        expect(() => formatToolResult('rav_capture_canvas', { image: { data: '' } }))
            .toThrow('invalid canvas screenshot payload');
    });

    it('keeps the JS and native rav_eval target contract explicit', () => {
        const evalTool = TOOLS.find((tool) => tool.name === 'rav_eval');
        const nativeRegistry = readFileSync(resolve('src-tauri/src/bin/rav-mcp/tool_registry.rs'), 'utf8');

        expect(evalTool.inputSchema.properties.target).toEqual({
            description: 'Evaluation surface. Default: auto.',
            enum: ['auto', 'host', 'playback'],
            type: 'string',
        });
        expect(nativeRegistry).toContain('"target": { "type": "string", "enum": ["auto", "host", "playback"]');
    });
});
