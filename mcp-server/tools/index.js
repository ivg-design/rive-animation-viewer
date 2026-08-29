import { CORE_TOOLS } from './core-tools.js';
import { EDITOR_TOOLS } from './editor-tools.js';
import { GLOBAL_VM_TOOLS } from './global-vm-tools.js';

export const TOOLS = [
  ...CORE_TOOLS,
  ...GLOBAL_VM_TOOLS,
  ...EDITOR_TOOLS,
];
