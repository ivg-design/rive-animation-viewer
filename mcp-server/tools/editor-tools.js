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
      'animation — call rav_get_editor_code first, preserve the current structure, avoid fake FILE placeholders, then call rav_apply_code.',
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
    name: 'rav_open_isolated_playback',
    description:
      'Open the current animation in a separate, ordinary opaque Tauri webview using the exact self-contained standalone-export payload. ' +
      'This is an in-app A/B diagnostic surface for comparing RAV plumbing against isolated playback; it does not save a file or change the main RAV window.',
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
    name: 'rav_export_demo_visual',
    description:
      'Orchestrate the Snippet & Export Controls dialog visually: open the dialog, apply the control selection, set package source and snippet mode, click Export, and write the demo to output_path. ' +
      'Use this when the export needs to be visible (screen recordings) or when a non-default control selection is required. For pure programmatic export, use rav_export_demo.',
    inputSchema: {
      type: 'object',
      properties: {
        output_path: {
          type: 'string',
          description: 'Absolute path where the exported HTML demo will be saved.',
        },
        selection: {
          oneOf: [
            { type: 'string', enum: ['all', 'changed', 'none'] },
            { type: 'array', items: { type: 'string' }, description: 'Explicit list of control snapshot keys to enable.' },
          ],
          description:
            "How to populate the dialog's control selection. 'all' clicks SELECT ALL, 'changed' clicks CHANGED ONLY, 'none' clicks CLEAR, or pass an explicit array of control keys.",
        },
        package_source: {
          type: 'string',
          enum: ['cdn', 'local'],
          description: 'Optional. Sets the package source select. Default: leave as-is.',
        },
        snippet_mode: {
          type: 'string',
          enum: ['compact', 'scaffold'],
          description: 'Optional. Sets the snippet mode select. Default: leave as-is.',
        },
        step_delay_ms: {
          type: 'number',
          description: 'Milliseconds between visible steps so a recording captures each. Default: 250.',
        },
      },
      required: ['output_path'],
      additionalProperties: false,
    },
  },
  {
    name: 'generate_web_instantiation_code',
    description:
      'Generate a copy-paste-ready web instantiation snippet for the animation currently loaded in RAV. ' +
      'The snippet mirrors the live source mode that is actually running in RAV: either internal wiring ' +
      'or the last applied editor code. Supports either CDN or local npm package usage, restores the current ' +
      'ViewModel/state-machine values on load, and exposes helper controls on window.ravRive. This is the preferred way to provide a working runtime-control snippet.',
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
    description:
      'Open the bottom console panel. Defaults to JS mode. Optional `mode`, `level`, `sources`, and `search` apply pre-configured filter state on open.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['events', 'js'], description: 'Mode to activate on open. Default: js.' },
        level: { type: 'string', enum: ['all', 'info', 'warning', 'error'], description: 'JS console level filter (only applies when mode is js).' },
        sources: {
          type: 'array',
          items: { type: 'string', enum: ['native', 'riveUser', 'ui', 'mcp'] },
          description: 'Event console source toggles to enable (only applies when mode is events). Sources omitted are hidden.',
        },
        search: { type: 'string', description: 'Substring filter applied to console entries.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'rav_console_close',
    description: 'Close the JavaScript console panel (switches back to Event Console mode).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'rav_console_set_mode',
    description: "Set the bottom console panel mode to Event Console ('events'), JS REPL ('js'), or close it ('closed'). Opens the panel first if needed.",
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['events', 'js', 'closed'], description: 'Console mode to activate.' },
      },
      required: ['mode'],
      additionalProperties: false,
    },
  },
  {
    name: 'rav_console_set_filter',
    description:
      'Apply filters to the rendered console transcript. Mirrors the existing on-screen filter toggles. ' +
      'JS mode supports `level` (all/info/warning/error). Events mode supports `sources` (subset of native/riveUser/ui/mcp — sources omitted from the array are hidden). ' +
      'Both modes support `search`. Targets the currently active mode if `mode` is omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['events', 'js'], description: 'Optional — apply to a specific mode. Defaults to the currently active mode.' },
        level: { type: 'string', enum: ['all', 'info', 'warning', 'error'], description: 'JS console level filter.' },
        sources: {
          type: 'array',
          items: { type: 'string', enum: ['native', 'riveUser', 'ui', 'mcp'] },
          description: 'Event console source toggles to enable. Sources omitted from the array are hidden.',
        },
        search: { type: 'string', description: 'Substring filter applied to entry text. Empty string clears the search filter.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'rav_console_clear',
    description: 'Clear the visible transcript of the bottom console panel (Events or JS mode). Does not close the panel.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['events', 'js'], description: "Optional — clear a specific mode's transcript. Defaults to the currently active mode." },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'rav_console_read',
    description:
      'Read the JS console transcript, including REPL input/result rows and ' +
      'captured console.log/warn/error/info/debug output. Returns the most ' +
      'recent entries with method, timestamp, and args.',
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
      'browser context with output displayed in the console panel. Use ' +
      'rav_console_read to inspect the resulting transcript, including REPL ' +
      'input/result rows. Opens the console automatically if not already open.',
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
