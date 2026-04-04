#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { sendCommand } from './bridge.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { TOOLS } from './tools/index.js';

const server = new Server(
  {
    name: 'rav-mcp',
    version: '1.0.1',
  },
  {
    capabilities: {
      tools: {},
    },
    instructions: SERVER_INSTRUCTIONS,
  }
);

// List tools
server.setRequestHandler(
  ListToolsRequestSchema,
  async () => ({ tools: TOOLS })
);

// Call tool
server.setRequestHandler(
  CallToolRequestSchema,
  async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await sendCommand(name, args || {});
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return {
        content: [{ type: 'text', text }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[rav-mcp] MCP server started (stdio transport)\n`);
}

main().catch((error) => {
  process.stderr.write(`[rav-mcp] Fatal: ${error.message}\n`);
  process.exit(1);
});
