import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';

import { COMMAND_TIMEOUT_MS, WS_PORT } from './config.js';

let ravSocket = null;
let ravConnectedAt = null;
const pendingRequests = new Map();

const wss = new WebSocketServer({ port: WS_PORT, host: '127.0.0.1' });

wss.on('listening', () => {
  process.stderr.write(`[rav-mcp] WebSocket bridge listening on ws://127.0.0.1:${WS_PORT}\n`);
});

wss.on('connection', (ws) => {
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
    if (!pending) {
      return;
    }
    pendingRequests.delete(msg.id);
    clearTimeout(pending.timer);
    if (msg.error) {
      pending.reject(new Error(msg.error));
      return;
    }
    pending.resolve(msg.result);
  });

  ws.on('close', () => {
    if (ws !== ravSocket) {
      return;
    }
    ravSocket = null;
    ravConnectedAt = null;
    process.stderr.write(`[rav-mcp] RAV disconnected\n`);
    for (const [id, pending] of pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('RAV disconnected'));
      pendingRequests.delete(id);
    }
  });

  ws.on('error', (err) => {
    process.stderr.write(`[rav-mcp] WebSocket error: ${err.message}\n`);
  });
});

export function getBridgeStatus() {
  return {
    ravConnectedAt,
    ready: Boolean(ravSocket && ravSocket.readyState === ravSocket.OPEN),
  };
}

export function sendCommand(command, params = {}) {
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
