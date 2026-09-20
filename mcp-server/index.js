#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { sendCommand } from './bridge.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { formatToolResult } from './tool-result.js';
import { TOOLS, gatedTools } from './tools/index.js';

const ENTITLEMENT_STATUS_TIMEOUT_MS = 1500;

const server = new Server(
  {
    name: 'rav-mcp',
    version: '1.0.1',
  },
  {
    capabilities: {
      tools: { listChanged: true },
    },
    instructions: SERVER_INSTRUCTIONS,
  }
);

// Last-known app entitlement unlock state, used to detect a transition after
// a rav_entitlement_status call and emit tools/list_changed accordingly.
let lastKnownUnlocked = false;

// List tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = [...TOOLS];
  try {
    const status = await sendCommand(
      'rav_entitlement_status',
      {},
      ENTITLEMENT_STATUS_TIMEOUT_MS
    );
    if (status && status.unlocked === true) {
      const grantedScopes = typeof status.scope === 'string' ? [status.scope] : [];
      tools.push(...gatedTools(grantedScopes));
    }
  } catch {
    // App not connected or errored: never fail tools/list, advertise base list only.
  }
  return { tools };
});

// Call tool
server.setRequestHandler(
  CallToolRequestSchema,
  async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await sendCommand(name, args || {});
      if (result && typeof result.unlocked === 'boolean' && result.unlocked !== lastKnownUnlocked) {
        lastKnownUnlocked = result.unlocked;
        server.notification({ method: 'notifications/tools/list_changed' });
      }
      return formatToolResult(name, result);
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
