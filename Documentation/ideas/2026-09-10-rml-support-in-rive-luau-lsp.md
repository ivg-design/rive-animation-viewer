# Idea: RML support in rive-luau-lsp

Captured: 2026-09-10

Status: Parked feature idea for future design

Origin: Comparison of `rive lsp` (rive-cli 0.1.22) against `rive-luau-lsp` 1.2.1
on the same scripts, driven over stdio with a JSON-RPC harness.

## What was measured

- Core Luau type checking is identical. Both servers are luau-lsp derivatives
  with the same checker; the deliberately broken fixture produced the same
  eight diagnostics at the same positions, word for word. Member completion on
  `Renderer` returned the same seven methods.
- `rive lsp` serves `.rml` documents with diagnostics that are byte-identical
  to `rive inspect --json` → `problems` (unknown element with did-you-mean,
  dangling `viewModelPropertyId`, bind paths, the 19 semantic `kind`s). It has
  **no** hover or completion for RML; both return `null`.
- `rive lsp` types `Data.<ViewModel>` from the project's RML. Breaking the RML
  property made `main.luau` lose `Data.Settings.speed`, proving the derivation.
- Our server falls back to `__RiveDataViewModel = ViewModel & {[string]: any}`
  via `TYPE_NAMESPACE_FALLBACKS` in the `LuauExt.cpp` patch
  (`importedTypeBindings["Data"].fallback`). Consequence: a false positive
  (`does not have key 'speed'`) on every script that reads a bound VM property.
- Our server has the larger LSP surface (rename, references, signature help,
  inlay hints, code actions, symbols, folding) and a standalone analyzer;
  `rive lsp` advertises six capabilities and has no per-file analyze CLI.

## Concept

Two layers, independent of each other.

### Layer A — project-typed `Data.*` (small, removes the false positive)

- Generator (Node, in the wrapper) that emits
  `export type __RiveData_<Name> = ViewModel & { <prop>: Property<kind>, … }`
  for every ViewModel, from either:
  - the project's RML (`<ViewModel>` → `<ViewModelProperty{Number,String,
    Boolean,Color,Enum,Trigger,List,ViewModel,Image…}>`), or
  - a compiled `.riv` through RAV's file inspection, whose normalized
    `viewModelMap.prototypes[].properties[{name, kind, viewModelRef}]` is
    already the needed shape. This is something `rive lsp` cannot do.
- Patch extension (~15 lines next to `applyTypeNamespaceFallbacks`): read
  `TYPE_NAMESPACE_BINDINGS: {"Data": {"Settings": "__RiveData_Settings"}}` from
  the definitions metadata line and set
  `importedTypeBindings["Data"]["Settings"] = tf`. The named-binding map
  already exists in Luau; only the fallback was added before.
- Wrapper flags: `rive-luau-analyze --project <dir>` / `--riv <file.riv>`
  regenerate definitions per run. The live server loads definitions at startup,
  so RML edits need a restart or a watcher-triggered restart; this is the one
  place `rive lsp` is inherently ahead because it owns the parse.

### Layer B — RML documents

- Delegate route: a small companion LSP registered for the `rml` language that
  runs `rive inspect --json` on save and maps `problems`
  (`line`, `severity`, `kind`, `message`) to diagnostics. Exact parity for
  near-zero code; requires `rive` on `PATH`. luau-lsp itself will not serve
  `.rml`, so this is a sibling process, not a patch.
- Schema route: `rive schema --list </dev/null` and `rive schema <Type>` are
  non-interactive and parseable (typeKey, property keys, value types,
  defaults, `accepts:` enum names, inheritance chain, A/B/D flags). A one-time
  dump of all 417 types gives element/attribute/enum validation plus RML
  **completion and hover**, which `rive lsp` lacks entirely. Do not chase
  parity on the semantic `problems` kinds (bind-path resolution, overlap
  checks); leave those to the delegate route.

## Open questions

- Definition reload: does luau-lsp re-read definition files on
  `workspace/didChangeConfiguration`, or is a restart the only option?
- `Data.X.new()` constructor typing for generated types.
- Whether the `rive schema` text format is stable enough to parse, or whether
  to ask Rive for `--format=json` on `schema`.

## Resume point

Prototype the Layer A generator against the `rml_vm_input` sample and against
its live-link-captured `.riv`, then draft the patch diff. Measure that the
`main.luau` false positive disappears and that hover on `settings.speed`
reports `Property<number>`.
