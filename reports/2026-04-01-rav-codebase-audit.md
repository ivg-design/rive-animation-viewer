# RAV Codebase Audit

Date: 2026-04-01
Branch: `codex/rav-codebase-audit`
Commit audited: `cfc5982`

## Executive Summary

RAV is a useful, differentiated product with strong domain fit: it combines a local `.riv` viewer, developer-facing inspection tools, a Tauri desktop shell, and an MCP control surface in a way that is genuinely practical for animation workflows. The codebase reflects that product clarity.

The main weakness is not feature capability but implementation shape. The browser app has accreted into a large imperative controller (`app.js`, 5,059 lines) plus a large stylesheet (`style.css`, 2,136 lines), with broad `window`-level APIs, inline DOM handlers, and several intentionally permissive execution paths. This is workable for a solo-tooling codebase, but it is now large enough that maintainability, regression risk, and trust-boundary clarity are the limiting factors.

## Audit Scope

Reviewed:

- Root app shell and runtime controller
- Tauri desktop wrapper
- MCP server and browser bridge
- Build/release scripts
- Documentation and repo hygiene

Validated by running:

- `npm ci`
- `npm run build`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm audit --json`

Results:

- Root frontend build passed after installing dependencies.
- Tauri Rust check passed.
- `npm audit` reported 2 high-severity dev-tooling advisories in `rollup` and `picomatch`.

## Architecture Snapshot

Current architecture is a three-surface system:

1. Frontend app
   `index.html` + `app.js` + `style.css`, served by Vite or embedded into Tauri.
2. Desktop shell
   `src-tauri/src/main.rs` exposes a narrow set of file/window/export commands and single-instance handoff.
3. MCP control path
   `mcp-server/index.js` exposes MCP tools over stdio and forwards them through `mcp-bridge.js` over local WebSocket to the frontend.

This split is directionally good. The problem is that the frontend surface has become the de facto integration layer for almost everything: runtime loading, file I/O coordination, UI rendering, event logging, VM introspection, MCP hooks, editor evaluation, and Tauri bridge fallback behavior all live in the same file.

## What Is Working Well

- The product boundary is clear. The repo is focused on one tool, not a generic framework experiment.
- The Tauri layer is comparatively disciplined. `src-tauri/src/main.rs` is compact and mostly limited to app-shell concerns such as file reads, window state, demo export, and open-file forwarding.
- Runtime compatibility handling is pragmatic. The code probes for Rive API variations instead of assuming one exact shape, especially in VM/state-machine access and default state-machine detection.
- Observability is good for a local tool. The event console and MCP status affordances make the app easier to debug in practice.
- Build artifacts are intentionally portable. Bundling the MCP server into `src-tauri/resources/rav-mcp-server.js` is a good packaging decision for the desktop app.

## Findings

### High: Frontend maintainability has crossed the threshold where change risk is now structural

Evidence:

- `app.js` is 5,059 lines and mixes state, rendering, runtime orchestration, Tauri interop, MCP hooks, and editor behavior.
- `style.css` is 2,136 lines with the same monolithic pattern.
- Inline DOM actions in `index.html` couple markup directly to globals, for example `onclick="handleFileButtonClick()"`, `onclick="reset()"`, `onclick="play()"`, `onclick="pause()"`, `onclick="createDemoBundle()"`, and `onclick="showMcpSetup()"` in `index.html:24`, `index.html:36`, `index.html:39`, `index.html:42`, `index.html:49`, and `index.html:109`.
- Core controller functions are exported to globals in `app.js:4362-4401`.

Why it matters:

- There are no real module boundaries inside the browser app.
- State changes are implicit and shared through file-level mutable variables.
- Behavior is difficult to test in isolation.
- Every new feature increases the cost of reasoning about side effects.

Recommendation:

- Split the frontend into ES modules by domain: runtime loader, file/session state, event log, VM controls, artboard switcher, editor, MCP bridge hooks, and Tauri bridge.
- Introduce a single explicit state container or controller object instead of file-scoped mutable globals.
- Remove inline HTML handlers and bind events from JS modules only.

### High: Trust boundaries are intentionally permissive, but the codebase does not clearly separate “developer power” from “unsafe execution”

Evidence:

- The script editor evaluates arbitrary JavaScript with `eval` in `app.js:2723-2744`.
- MCP exposes `rav_eval` for arbitrary browser-context execution in `mcp-bridge.js:502-516`.
- The MCP tool catalog explicitly promotes `rav_eval` as a fallback in `mcp-server/index.js:417-434` and `mcp-server/index.js:477-480`.
- Tauri disables CSP and enables global Tauri APIs in `src-tauri/tauri.conf.json:12-17`.
- The app pulls `lucide@latest` from `unpkg` at runtime in `index.html:10`.

Why it matters:

- RAV is a local developer tool, so some unsafe capability is expected.
- The current implementation makes unsafe capability the default posture rather than an explicitly gated mode.
- This broadens the blast radius of any malicious pasted config, compromised local MCP client, or compromised third-party script.

Recommendation:

- Define two explicit modes: normal operation and unsafe/dev scripting mode.
- Keep arbitrary eval behind an explicit opt-in UI gate, warning, or launch flag.
- Remove `lucide@latest` and vendor or pin the asset.
- Reintroduce a minimal CSP where possible, even if certain exceptions are required for dev tooling.
- Narrow the `window` API surface exposed to the MCP bridge.

### Medium: Runtime loading and build behavior are not hermetic

Evidence:

- Runtime assets are resolved and fetched from external registries/CDNs in `app.js:607-610`, `app.js:764-776`, `app.js:2912-2968`, and `app.js:4912-4934`.
- `scripts/bundle-mcp-server.mjs` installs nested dependencies during build if `mcp-server/node_modules` is missing (`scripts/bundle-mcp-server.mjs:17-21`).
- `npm audit --json` reports 2 high-severity advisories in the dev toolchain (`rollup`, `picomatch`).

Why it matters:

- First-run or clean-worktree behavior depends on network availability.
- Build steps mutate the workspace and can silently normalize nested lockfiles.
- Reproducibility is weaker than it should be for desktop release engineering.

Recommendation:

- Treat the MCP server as a first-class workspace package with deterministic install/build steps rather than auto-installing it during `npm run build`.
- Ship at least one pinned local runtime fallback for offline and deterministic startup.
- Patch or override vulnerable dev-tooling transitive dependencies.

### Medium: Tooling quality gates are minimal for a codebase of this size

Evidence:

- Root scripts in `package.json:6-13` include build/dev/sync, but no `test`, `lint`, `typecheck`, or formatting scripts.
- No lint/test config files were found in the repo root.
- No test files were found via repository search.

Why it matters:

- The code relies heavily on DOM mutation, runtime branching, and API probing.
- Without automated checks, regressions will surface only through manual use.
- Refactoring the monolith safely will be much slower.

Recommendation:

- Add baseline automated checks before any large refactor:
  - ESLint
  - a small unit-test layer for pure helpers
  - a smoke test that boots the app and verifies major controls
  - one MCP integration smoke test
- If a full TypeScript migration is too expensive immediately, add JSDoc types and `// @ts-check` to extracted modules first.

### Medium: Documentation and release-process artifacts are drifting from reality

Evidence:

- Root package version is `1.9.9` in `package.json:3`, while the README release banner still says `1.9.3` in `README.md:5-7`.
- `.github/RELEASE.md` describes a commit-message/pre-push-hook release flow and still references version `1.1.2` in `.github/RELEASE.md:9-46`.
- The actual release workflow is tag/manual-dispatch driven in `.github/workflows/release.yml:3-23`.
- The `web/` subtree contains partial Next.js-style files (`web/src/app/docs/page.tsx`, `web/src/components/FeaturesSection.tsx`) without the package/config structure needed to build them.

Why it matters:

- Repo newcomers cannot tell which release process is real.
- Stale docs reduce trust in the rest of the documentation.
- Partial unintegrated subtrees create noise and false architectural signals.

Recommendation:

- Make one source of truth for release flow and versioning.
- Add a lightweight docs consistency check for version numbers and release instructions.
- Either finish the `web/` app and wire it into workspace tooling, or move/archive it outside the main product repo until it is real.

### Low: Some build metadata is already showing consistency drift

Evidence:

- `mcp-server/package.json` reports version `1.0.1` in `mcp-server/package.json:1-4`.
- During audit, `npm install` normalized `mcp-server/package-lock.json` to the same version, which indicates the tracked lockfile on `main` had been left stale relative to the package manifest.

Why it matters:

- This is not a major runtime defect, but it is a sign that nested package maintenance is easy to miss in the current setup.

Recommendation:

- Add lockfile consistency checks to CI, especially if the MCP server remains a nested package instead of a managed workspace package.

## Design Evaluation

From a product-design perspective, the tool is strong. The UI is dense but purpose-built, and the feature set is coherent for animation debugging.

From a software-design perspective, the implementation is currently “successful but over-centralized.” The code reads like a fast-moving product that kept shipping features into the same control file. That is a normal phase, but RAV is now beyond the size where this remains cheap.

## Suggested Roadmap

### Phase 1: Reduce immediate risk

- Pin or vendor third-party browser assets.
- Patch `rollup` and `picomatch`.
- Make the release docs truthful again.
- Stop auto-installing nested MCP dependencies during build.

### Phase 2: Carve out module boundaries

- Extract `runtime-loader.js`
- Extract `vm-controls.js`
- Extract `event-log.js`
- Extract `mcp-hooks.js`
- Extract `tauri-bridge.js`

Keep behavior unchanged while moving code.

### Phase 3: Add safety rails

- Add linting and smoke tests.
- Add `@ts-check` or TypeScript to extracted modules.
- Introduce a formal unsafe scripting mode.

### Phase 4: Clean repository shape

- Decide whether `web/` is real product code or parked exploratory work.
- Make nested packages workspace-managed or flatten the build model.

## Overall Assessment

- Product value: High
- Architecture direction: Good
- Current implementation discipline: Mixed
- Robustness: Moderate, but highly dependent on manual verification
- Security posture: Acceptable for a local power tool only if the unsafe surfaces remain intentional and well-signposted
- Maintainability trend: Negative unless the frontend is modularized soon

## Bottom Line

RAV is already a capable tool. The next step is not more surface area; it is turning the existing surface area into a codebase with explicit boundaries, reproducible builds, and clearly named unsafe capabilities. If that happens, the project becomes much easier to extend without losing trust in it.
