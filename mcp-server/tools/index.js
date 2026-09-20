import { MEDIA_TOOLS } from './media-tools.js';
import { CORE_TOOLS } from './core-tools.js';
import { EDITOR_TOOLS } from './editor-tools.js';
import { GLOBAL_VM_TOOLS } from './global-vm-tools.js';
import { ENTITLEMENT_TOOLS } from './entitlement-tools.js';

const SCOPE_KEY = 'x-rav-scope';

const ENTITLEMENT_STATUS_TOOL = ENTITLEMENT_TOOLS.find(
  (tool) => tool.name === 'rav_entitlement_status'
);

export const TOOLS = [
  ...CORE_TOOLS,
  ...MEDIA_TOOLS,
  ...GLOBAL_VM_TOOLS,
  ...EDITOR_TOOLS,
  ENTITLEMENT_STATUS_TOOL,
];

// Tools gated behind an entitlement scope, advertised only once that scope
// is present in `grantedScopes`. The internal x-rav-scope marker is stripped
// before the tool definition is handed back for advertising.
export function gatedTools(grantedScopes) {
  return ENTITLEMENT_TOOLS.filter(
    (tool) => tool[SCOPE_KEY] && grantedScopes.includes(tool[SCOPE_KEY])
  ).map((tool) => {
    const { [SCOPE_KEY]: _scope, ...rest } = tool;
    return rest;
  });
}
