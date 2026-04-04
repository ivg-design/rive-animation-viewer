/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Runtime dependency cycles make the app harder to refactor and reason about.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-core-to-app-layers",
      severity: "error",
      comment: "src/app/core must stay dependency-light and never reach into platform, rive, ui, or root entrypoints.",
      from: { path: "^src/app/core/" },
      to: { path: "^(app\\.js|mcp-bridge\\.js|mcp-server/index\\.js|src/app/(platform|rive|ui)/)" },
    },
    {
      name: "no-platform-to-ui-or-roots",
      severity: "error",
      comment: "Platform modules may use core/rive, but must not import UI surfaces or root entrypoints.",
      from: { path: "^src/app/platform/" },
      to: { path: "^(app\\.js|mcp-bridge\\.js|mcp-server/index\\.js|src/app/ui/)" },
    },
    {
      name: "no-rive-to-platform-ui-or-roots",
      severity: "error",
      comment: "Rive runtime modules should stay isolated from platform wiring, UI, and root entrypoints.",
      from: { path: "^src/app/rive/" },
      to: { path: "^(app\\.js|mcp-bridge\\.js|mcp-server/index\\.js|src/app/(platform|ui)/)" },
    },
    {
      name: "no-ui-to-platform-or-roots",
      severity: "error",
      comment: "UI modules may compose core and rive concerns, but platform wiring stays outside the UI layer.",
      from: { path: "^src/app/ui/" },
      to: { path: "^(app\\.js|mcp-bridge\\.js|mcp-server/index\\.js|src/app/platform/)" },
    },
  ],
  options: {
    doNotFollow: {
      path: "^(node_modules|vendor|dist|coverage|tests|web|src-tauri|target)/",
    },
    exclude: {
      path: "^(node_modules|vendor|dist|coverage|tests|web|src-tauri|target)/",
    },
    includeOnly: "^((app\\.js|mcp-bridge\\.js|mcp-server/index\\.js)|src/app/)",
    tsPreCompilationDeps: false,
  },
};
