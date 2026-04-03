export const EDITOR_TOOLS = [
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
    name: 'generate_web_instantiation_code',
    description:
      'Generate a copy-paste-ready web instantiation snippet for the animation currently loaded in RAV. ' +
      'The snippet mirrors the live source mode that is actually running in RAV: either internal wiring ' +
      'or the last applied editor code. Supports either CDN or local npm package usage, restores the current ' +
      'ViewModel/state-machine values on load, and exposes helper controls on window.ravRive.',
    inputSchema: {
      type: 'object',
      properties: {
        package_source: {
          type: 'string',
          enum: ['cdn', 'local'],
          description: 'Use a CDN/global runtime snippet or a local npm package import snippet.',
        },
        snippet_mode: {
          type: 'string',
          enum: ['compact', 'scaffold'],
          description: 'Use a compact snippet with only selected live controls, or a scaffold snippet that lists all controls with unselected ones commented out.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'rav_toggle_instantiation_controls_dialog',
    description:
      'Open, close, or toggle the Snippet & Export Controls dialog inside RAV. ' +
      'Use this when a human user should choose exactly which bound controls are serialized into snippets and demos.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['open', 'close', 'toggle'],
          description: 'Whether to open, close, or toggle the dialog. Defaults to toggle.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'rav_configure_workspace',
    description:
      'Set workspace UI state inside RAV. This can open or close the left/right ' +
      'sidebars, switch the live instantiation source between internal and editor ' +
      'mode, and inject or remove the VM Explorer snippet without guessing the current state.',
    inputSchema: {
      type: 'object',
      properties: {
        left_sidebar: {
          type: 'string',
          enum: ['open', 'close'],
          description: 'Open or close the left editor sidebar.',
        },
        right_sidebar: {
          type: 'string',
          enum: ['open', 'close'],
          description: 'Open or close the right properties sidebar.',
        },
        source_mode: {
          type: 'string',
          enum: ['internal', 'editor'],
          description:
            'Set the live instantiation source. "editor" applies the current draft code; ' +
            '"internal" switches back to RAV wiring.',
        },
        vm_explorer: {
          type: 'string',
          enum: ['inject', 'remove'],
          description: 'Ensure the VM Explorer snippet is present or removed in the editor draft.',
        },
      },
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
  {
    name: 'rav_console_open',
    description: 'Open the JavaScript console panel (switches from Event Console to JS Console mode).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'rav_console_close',
    description: 'Close the JavaScript console panel (switches back to Event Console mode).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'rav_console_read',
    description:
      'Read captured console output (console.log/warn/error/info/debug). ' +
      'Returns the most recent entries with method, timestamp, and args.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum entries to return (default 50)',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'rav_console_exec',
    description:
      'Execute JavaScript in the REPL console. The code is evaluated in the ' +
      'browser context with output displayed in the console panel. ' +
      'Opens the console automatically if not already open.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'JavaScript code to execute in the console REPL',
        },
      },
      required: ['code'],
      additionalProperties: false,
    },
  },
];
