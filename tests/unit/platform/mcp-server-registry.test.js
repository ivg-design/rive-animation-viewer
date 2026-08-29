import { describe, expect, it } from 'vitest';
import { formatToolResult } from '../../../mcp-server/tool-result.js';
import { TOOLS } from '../../../mcp-server/tools/index.js';

describe('legacy MCP server registry', () => {
    it('advertises canvas capture exactly once', () => {
        const captureTools = TOOLS.filter((tool) => tool.name === 'rav_capture_canvas');
        expect(captureTools).toHaveLength(1);
        expect(captureTools[0].inputSchema).toEqual({
            additionalProperties: false,
            properties: {},
            type: 'object',
        });
        expect(new Set(TOOLS.map((tool) => tool.name)).size).toBe(TOOLS.length);
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
});
