export const GLOBAL_VM_TOOLS = [
  {
    name: 'rav_get_global_vm_tree',
    description: 'List every file-level global ViewModel with its live hierarchy, paths, kinds, and values.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'rav_global_vm_get',
    description: 'Get a value from a named file-level global ViewModel.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, description: 'Global ViewModel name returned by rav_get_global_vm_tree' },
        path: { type: 'string', minLength: 1, description: 'Slash- or dot-separated property path inside the named global ViewModel' },
      },
      required: ['name', 'path'], additionalProperties: false,
    },
  },
  {
    name: 'rav_global_vm_set',
    description: 'Set a number, boolean, string, enum, or color property on a named file-level global ViewModel.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1 }, path: { type: 'string', minLength: 1 }, value: {},
      },
      required: ['name', 'path', 'value'], additionalProperties: false,
    },
  },
  {
    name: 'rav_global_vm_fire',
    description: 'Fire a trigger on a named file-level global ViewModel.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', minLength: 1 }, path: { type: 'string', minLength: 1 } },
      required: ['name', 'path'], additionalProperties: false,
    },
  },
  {
    name: 'rav_global_vm_set_image',
    description: 'Set an image property on a named file-level global ViewModel through the authoritative playback surface.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1 },
        path: { type: 'string', minLength: 1 },
        bytes: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 255 }, minItems: 1, maxItems: 16777216 },
        label: { type: 'string', maxLength: 255 },
      },
      required: ['name', 'path', 'bytes'], additionalProperties: false,
    },
  },
  {
    name: 'rav_global_vm_clear_image',
    description: 'Clear an image property on a named file-level global ViewModel through the authoritative playback surface.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', minLength: 1 }, path: { type: 'string', minLength: 1 } },
      required: ['name', 'path'], additionalProperties: false,
    },
  },
];
