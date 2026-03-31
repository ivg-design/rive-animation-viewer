#!/usr/bin/env node

/**
 * RAV MCP Server
 *
 * Model Context Protocol server for Rive Animation Viewer.
 * Exposes RAV's capabilities as MCP tools so Claude Code (or any MCP client)
 * can control the running app: open files, inspect ViewModels, drive playback,
 * manipulate inputs, read event logs, and export demos.
 *
 * Architecture:
 *   Claude Code <--(stdio)--> MCP Server <--(WebSocket :9274)--> RAV Frontend
 *
 * The server starts a local WebSocket server. RAV's frontend connects as a
 * client when the MCP bridge is enabled. Commands flow as JSON-RPC over WS.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const WS_PORT = parseInt(process.env.RAV_MCP_PORT || '9274', 10);
const COMMAND_TIMEOUT_MS = parseInt(process.env.RAV_MCP_TIMEOUT || '15000', 10);

// ---------------------------------------------------------------------------
// WebSocket bridge — RAV connects here
// ---------------------------------------------------------------------------

let ravSocket = null;
let ravConnectedAt = null;
const pendingRequests = new Map();

const wss = new WebSocketServer({ port: WS_PORT, host: '127.0.0.1' });

wss.on('listening', () => {
  process.stderr.write(`[rav-mcp] WebSocket bridge listening on ws://127.0.0.1:${WS_PORT}\n`);
});

wss.on('connection', (ws) => {
  // Only allow one RAV connection at a time
  if (ravSocket && ravSocket.readyState === ws.OPEN) {
    ravSocket.close(1000, 'Replaced by new connection');
  }
  ravSocket = ws;
  ravConnectedAt = new Date().toISOString();
  process.stderr.write(`[rav-mcp] RAV connected\n`);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      process.stderr.write(`[rav-mcp] Received invalid JSON from RAV\n`);
      return;
    }

    const pending = pendingRequests.get(msg.id);
    if (pending) {
      pendingRequests.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.error) {
        pending.reject(new Error(msg.error));
      } else {
        pending.resolve(msg.result);
      }
    }
  });

  ws.on('close', () => {
    if (ws === ravSocket) {
      ravSocket = null;
      process.stderr.write(`[rav-mcp] RAV disconnected\n`);
      // Reject all pending requests
      for (const [id, pending] of pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(new Error('RAV disconnected'));
        pendingRequests.delete(id);
      }
    }
  });

  ws.on('error', (err) => {
    process.stderr.write(`[rav-mcp] WebSocket error: ${err.message}\n`);
  });
});

/**
 * Send a command to RAV and wait for the response.
 */
function sendCommand(command, params = {}) {
  return new Promise((resolve, reject) => {
    if (!ravSocket || ravSocket.readyState !== ravSocket.OPEN) {
      reject(new Error(
        'RAV is not connected. Make sure the Rive Animation Viewer is running ' +
        `and has connected to ws://127.0.0.1:${WS_PORT}. ` +
        'Check the browser console for connection status.'
      ));
      return;
    }

    const id = randomUUID();
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Command "${command}" timed out after ${COMMAND_TIMEOUT_MS}ms`));
    }, COMMAND_TIMEOUT_MS);

    pendingRequests.set(id, { resolve, reject, timer });

    ravSocket.send(JSON.stringify({ id, command, params }));
  });
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'rav_status',
    description:
      'Get current RAV application status: loaded file, runtime, playback state, ' +
      'ViewModel summary, and connection info.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'rav_open_file',
    description:
      'Open a .riv file in RAV by its absolute file path. The file is read from ' +
      'disk and loaded into the viewer.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the .riv file on disk',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'rav_play',
    description: 'Start or resume animation playback.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'rav_pause',
    description: 'Pause animation playback.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'rav_reset',
    description:
      'Reset and restart the animation from the beginning, preserving ViewModel ' +
      'control values.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'rav_get_artboards',
    description:
      'List all artboard names available in the currently loaded .riv file.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'rav_get_state_machines',
    description:
      'List all state machine names on the current artboard.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'rav_switch_artboard',
    description:
      'Switch to a different artboard and/or playback target (state machine or animation). ' +
      'Auto-plays immediately. ViewModel controls re-populate for the new artboard.',
    inputSchema: {
      type: 'object',
      properties: {
        artboard: {
          type: 'string',
          description: 'Artboard name to switch to',
        },
        playback: {
          type: 'string',
          description:
            'Playback target. Prefix with "sm:" for state machine or "anim:" for timeline animation. ' +
            'E.g. "sm:State Machine 1" or "anim:idle". Omit to use the first available.',
        },
      },
      required: ['artboard'],
      additionalProperties: false,
    },
  },
  {
    name: 'rav_reset_artboard',
    description:
      'Reset to the default artboard and default state machine that was detected when the file was first loaded.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'rav_get_vm_tree',
    description:
      'Get the full ViewModel hierarchy tree for the loaded animation. Returns ' +
      'nested structure with property names, paths, kinds (number, boolean, ' +
      'string, enum, color, trigger), and child ViewModels/lists.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'rav_vm_get',
    description:
      'Get the current value of a ViewModel property by path. Use rav_get_vm_tree ' +
      'first to discover available paths.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Dot-separated or slash-separated property path, e.g. "root/nested/prop"',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'rav_vm_set',
    description:
      'Set the value of a ViewModel property by path. Supports number, boolean, ' +
      'string, enum, and color properties.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Property path (slash-separated)',
        },
        value: {
          description:
            'New value. Type must match the property kind: number for number, ' +
            'true/false for boolean, string for string/enum, ARGB integer for color.',
        },
      },
      required: ['path', 'value'],
      additionalProperties: false,
    },
  },
  {
    name: 'rav_vm_fire',
    description: 'Fire a trigger ViewModel property by path.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the trigger property',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'rav_get_event_log',
    description:
      'Get recent event log entries from RAV. Events include native runtime ' +
      'events, Rive user events, and UI events.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of entries to return (default 50)',
        },
        source: {
          type: 'string',
          enum: ['native', 'rive-user', 'ui', 'all'],
          description: 'Filter by event source (default "all")',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'rav_get_editor_code',
    description:
      'Get the current code in the RAV script editor (CodeMirror).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'rav_set_editor_code',
    description:
      'Replace the code in the RAV script editor. This does NOT reload the ' +
      'animation — call rav_apply_code afterwards to apply changes.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'JavaScript code to set in the editor',
        },
      },
      required: ['code'],
      additionalProperties: false,
    },
  },
  {
    name: 'rav_apply_code',
    description:
      'Apply the current editor code and reload the animation with the new ' +
      'configuration. Equivalent to clicking the "Apply & Reload" button.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'rav_set_runtime',
    description: 'Switch the Rive runtime engine.',
    inputSchema: {
      type: 'object',
      properties: {
        runtime: {
          type: 'string',
          enum: ['webgl2', 'canvas'],
          description: 'Runtime to switch to',
        },
      },
      required: ['runtime'],
      additionalProperties: false,
    },
  },
  {
    name: 'rav_set_layout',
    description: 'Set the canvas layout fit mode.',
    inputSchema: {
      type: 'object',
      properties: {
        fit: {
          type: 'string',
          enum: ['cover', 'contain', 'fill', 'fitWidth', 'fitHeight', 'scaleDown', 'none', 'layout'],
          description: 'Layout fit mode',
        },
      },
      required: ['fit'],
      additionalProperties: false,
    },
  },
  {
    name: 'rav_set_canvas_color',
    description:
      'Set the canvas background color. Use "transparent" for transparency mode.',
    inputSchema: {
      type: 'object',
      properties: {
        color: {
          type: 'string',
          description: 'CSS color value (hex like "#0d1117") or "transparent"',
        },
      },
      required: ['color'],
      additionalProperties: false,
    },
  },
  {
    name: 'rav_export_demo',
    description:
      'Export the current animation as a self-contained standalone HTML demo file. ' +
      'Provide output_path to save directly (recommended for MCP). ' +
      'Without output_path, opens a native save dialog (will timeout in MCP).',
    inputSchema: {
      type: 'object',
      properties: {
        output_path: {
          type: 'string',
          description:
            'Absolute path where the HTML demo will be saved. ' +
            'Parent directories are created automatically. ' +
            'If omitted, a native save dialog opens (not usable from MCP).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'rav_get_sm_inputs',
    description:
      'Get all state machine inputs for the current animation, with their ' +
      'names, types, and current values.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'rav_set_sm_input',
    description: 'Set a state machine input value by name.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'State machine input name',
        },
        value: {
          description: 'New value (number, boolean, or "fire" for triggers)',
        },
      },
      required: ['name', 'value'],
      additionalProperties: false,
    },
  },
  {
    name: 'rav_eval',
    description:
      'Evaluate arbitrary JavaScript in the RAV browser context. ' +
      'Has access to window.riveInst, window.vmGet/vmSet/vmFire, and all ' +
      'RAV globals. Use for advanced inspection or operations not covered ' +
      'by other tools. Returns the stringified result.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'JavaScript expression or statement to evaluate',
        },
      },
      required: ['expression'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const SERVER_INSTRUCTIONS = `
# RAV MCP — Rive Animation Viewer Remote Control

You are connected to a running instance of Rive Animation Viewer (RAV), a desktop app for inspecting .riv animation files.

## Quick Start Workflow
1. **rav_status** — Always call this first to see what's loaded and the current state.
2. **rav_open_file** — Open a .riv file by absolute path (Tauri desktop only).
3. **rav_get_artboards** / **rav_get_state_machines** — Discover what's in the file.
4. **rav_get_vm_tree** — Inspect the ViewModel hierarchy (properties, types, paths, current values).
5. Use **rav_vm_get** / **rav_vm_set** / **rav_vm_fire** to read, write, and fire ViewModel properties by path.

## Key Concepts

### Rive Runtime API
- \`contents\`, \`stateMachineNames\`, \`animationNames\` are **properties** (not functions) on the Rive instance.
- \`stateMachineInputs(smName)\` IS a function that takes the state machine name.
- \`viewModelInstance\` is a **property** that returns the bound ViewModel instance (requires \`autoBind: true\`).

### ViewModel Paths
- Properties use slash-separated paths: \`"parentVM/childVM/property"\`
- Supported kinds: \`number\`, \`boolean\`, \`string\`, \`enum\`, \`color\`, \`trigger\`
- Access pattern: \`vm.number("propName").value\` to read, \`vm.number("propName").value = 42\` to write
- Triggers use \`vm.trigger("propName").trigger()\` (note: the method is .trigger(), not .fire())

### Script Editor
- The editor holds a JavaScript object literal that configures the Rive instance.
- \`autoBind: true\` is required for ViewModel access.
- \`stateMachines: "Name"\` must be set to activate a state machine.
- Use **rav_set_editor_code** then **rav_apply_code** to change configuration and reload.

### State Machines vs ViewModels
- **State machine inputs** are the legacy way to control animations (boolean, number, trigger).
- **ViewModel properties** are the modern data-binding approach with richer types.
- Many animations have both — check rav_get_sm_inputs AND rav_get_vm_tree.

## Tips
- If rav_get_vm_tree returns empty but you suspect there's a ViewModel, ensure the editor config includes \`autoBind: true\` and \`stateMachines\` is set, then call rav_apply_code.
- Use **rav_eval** for anything not covered by the dedicated tools — it runs JS in the browser context with access to \`window.riveInst\` and all globals.
- **rav_get_event_log** shows runtime events, user events, UI events, and MCP events — useful for debugging what happened.
- **rav_export_demo** creates a self-contained HTML file with the current animation, runtime, and settings baked in.
`.trim();

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
