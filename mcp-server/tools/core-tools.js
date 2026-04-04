export const CORE_TOOLS = [
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
];
