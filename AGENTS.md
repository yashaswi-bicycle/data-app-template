# AGENTS.md — data-app-kit

## Which file do you need?

| You are | Do this |
| --- | --- |
| Building an app for someone, any kind | Connect the Bicycle Studio MCP and call `studio_guide` first; without it, read `docs/agents/INDEX.md`. Follow the protocol in `CLAUDE.md`. |
| Composing a dashboard-style app from a spec (the default) | Load `skills/ask-show-ship/SKILL.md` and use the `design_*` MCP tools (or `kit compose`). No code. |
| Hand-building an app: a screen no recipe draws, or an app that **calls functions, agents or workflows** | Work in `template/` and read `template/README-FOR-AGENTS.md`. Composed (spec) apps cannot call functions, agents or workflows yet: the kit runtime has no `bda.fn`, so switch to hand-build for those. |
| Building a function, an agent or a workflow for an app to call | `docs/agents/03-functions.md`, `04-agents.md`, `05-workflows.md`, and the `function_*` / `workflow_*` MCP tools. |
| Changing this kit (recipes, families, runtime, composer, schema) | Read the rest of this file. |

## What this repo is

Recipes + templates + a data-driven runtime + the composer that turns a DataAppSpec into a published Bicycle data app. Two ways to build an app:

- **compose** (default): `kit compose spec.json` → `bundle.zip`. No per-app code. The runtime is built once; each app is that bundle with `window.__DATA_APP_SPEC = {...}` prepended.
- **hand-build** (escape hatch): `template/` is the boilerplate for writing React by hand, for what the recipes cannot express and for apps that call functions, agents or workflows (`template/src/studio/bda.ts`). Rules in `template/README-FOR-AGENTS.md`.

**This repository owns how an app is created; the service owns who may create it and where it is stored.** The service (`bicycle-studio-api`) reads this kit's JSON — schema, recipes, templates, datasets — and renders it. It holds no knowledge of what a recipe, a family or a query is. Adding a family or changing a query must therefore be a change *here* and a kit release, never a code change there.

The one piece of machinery that exists in both languages is the dataset renderer (`compose/datasets.mjs` ↔ the service's port of it): a substitution engine with no product knowledge. `evals/manifest.golden.json` pins its output so the two cannot drift.

## Invariants — never change without a schema version bump

- `spec/dataapp-spec.v2.schema.json` is a public contract read by the MCP and the skill.
- The runtime emits exactly `app.js` and `app.css`; the host loads those names (`runtime/scripts/assert-dist.mjs` enforces it).
- **No SQL in code.** Every query is declared in `recipes/datasets.json` (core) or `families/<kind>/datasets.json`, and rendered by `compose/datasets.mjs`. That renderer may learn new substitutions; it must never learn what a dataset means.
- Query ids are derived, never authored. Core: `entity_list` (if entity), `totals`, `by_time`, `by_dimension` (if dimensions), `by_time_<dim>` (one per `trend.by`, max 3). `ab_test` family: `entity_list`, `experiment_meta`, `arm_totals`, `segments`, `daily_trend`. Recipes read only those (`runtime/src/spec.ts` → `QUERY`).
- **The runtime never fetches a URL — every capability is a message to the host.** Data comes through declared queries; cache and blobs come through `runtime/src/studio/store.ts`, which asks the host page (`studio:sandbox:store`) exactly as queries do. A recipe reaching for `fetch`, `localStorage` or a bucket URL is a bug. Store misses or failures render as a muted note, never an error card — see `runtime/src/studio/storeHooks.ts`.
- **Persistence is declared in the spec like queries; nothing undeclared is served.** `spec.store.cache` and `spec.store.blobs` become `cache` / `blobs` in the manifest; the service serves only those. A blob the spec does not name is refused with `store_not_declared`.
- The kit is model-agnostic. Nothing under `recipes/`, `templates/core/`, `runtime/` or `compose/` may name a field, metric column or model id. Model bindings live in tenant profiles (see `profiles/README.md`); `profiles/examples/` holds test fixtures only.
- This repo is public: no real customer model id or tenant metric/dimension name anywhere, `template/` and `examples/` included. `scripts/no-real-ids.sh` guards it — run it (optionally with `KIT_FORBIDDEN_IDS='id1|id2'`) before a PR; it always fails if an example `model` id under `spec/examples/`, `profiles/examples/`, `template/` or `examples/` doesn't start with `m_`, or if SQL in `template/` or `examples/` reads `FROM` a model that is not `m_…` or a `<placeholder>`.
- Components use `--bda-*` tokens only; colour values live in `runtime/src/theme.css`, both palettes plus the `data-accent` variants.
- Semantic SQL only: metrics are columns, `FROM <model>`, a bounded time range, no JOINs, no OR, no semicolons, ≤ 8000 chars — stated in full in `skills/semantic-query/SKILL.md`, and nowhere else.
- A spec composes to ≤ 32 queries; core specs use 2–6, `ab_test` specs use 5.

## Widgets never blank

1. Layout renders on first paint and never unmounts — header, controls, cards, headings appear immediately; only the inside of a card waits.
2. Each widget waits for ITS OWN query. Never gate `App` (or a chrome) on `data === undefined`; never early-return "Loading…" from a component that owns layout.
3. Skeletons sized to what is coming (`SkeletonChart` with the chart's height, `SkeletonMetric`, `SkeletonTable` with a row count), `aria-busy="true"` on the card while pending.
4. When a control changes (entity, measure, grain, dimensions, variant, heatmap axes), the widget keeps its previous rows visible with a quiet refreshing state and swaps when new rows arrive — skeleton only on first load or when the shape changes (different dimension). Use TanStack Query `placeholderData: keepPreviousData` in the dataset hooks; expose `isFetching` → class `kit-card--refreshing` (subtle, respects prefers-reduced-motion).
5. Errors are per widget: the card shows what failed (BdaError code + message) and a Retry button (refetch); the rest of the app stays usable.

## Layout

```
spec/             schema (v2) + examples: retail-orders-health/retail-refund-watch (core), checkout-test-report/explorer/scorecard (ab_test)
recipes/<id>/     core recipes — recipe.json (catalogue entry) + Render.tsx; work on any model
recipes/datasets.json        the core queries, declared
families/<kind>/datasets.json  a family's queries (set `replaces_core` when it reads the model differently)
families/<kind>/  an analysis family: family.json (derived metrics, roles, detection hints) + recipes/<id>/
templates/core/   recipe lists per persona for any model; templates/<family>/ override per family
profiles/         README + example tenant profiles (fixtures only; real profiles live in the API)
runtime/          the data-driven app: spec.ts, core.ts (generic maths), analysis.ts (ab_test maths), data.ts, ui.tsx, chrome/, App.tsx
compose/          validate → resolve → render datasets → bundle → upload; `cli.mjs` is `kit`
                  datasets.mjs is the renderer; manifest.mjs holds no SQL
                  diff.mjs is the typed spec diff behind `kit diff` (README's `## Diff`)
skills/ask-show-ship/   SKILL.md — the interview; published by the MCP as a prompt and resource
skills/semantic-query/  SKILL.md — the semantic SQL grammar and the query_* loop; the one statement of it, loaded by the interview, template/README-FOR-AGENTS.md and the app chat agent
evals/            golden manifests + transcript fixtures
template/         hand-build starter (do not add features here)
```

## Adding a recipe (core)

1. `mkdir recipes/<id>`; write `recipe.json` — `id`, `family: "core"`, `name`, `answers` (the question in the user's words), `shape` (sentence grammar with `[slots]`), `needs` (core datasets), `slots` (extra queries; keep 0), `fits` (personas), `bind` (each binding: `type` measure|measures|dim|dims|int|enum, `default` or `"ui"`), `caveat`.
2. `Render.tsx` exporting `Render({ spec, core, bind }: CoreProps)`. Read shared state through `useUi()` (`measure`, `dims`, heatmap axes), data through `core.totals`, `core.series`, `core.slicesAt(dims)`, `core.seriesBy`. Format with `fmtMeasure(value, measure.format)`. Chart with `components/Chart` and Plot; colours via `measureColor(spec, id)` / `var(--bda-*)`.
3. Register it in `CORE` in `runtime/src/App.tsx` and add its sentence to the grammar table in `SKILL.md`.
4. Put it in a template only if a persona needs it by default.
5. `npm run check`.

## Adding a family

A family is for data with a shape the core cannot express (arms vs control, funnel steps, cohorts).

1. `families/<kind>/family.json` — derived metrics, required roles, detection hints for `design_model_card`.
2. `families/<kind>/datasets.json` — the queries it needs, declared. Set `replaces_core: true` when the family reads the model differently rather than additionally.
3. `families/<kind>/recipes/<id>/` — its recipes (props `{ spec, data, bind }`).
4. `templates/<kind>/*.json` — its templates, each with its own `controls` defaults.
5. Extend the `family` `oneOf` in the schema; add the dataset hook in `runtime/src/data.ts` and register recipes in `runtime/src/App.tsx`.
6. `node evals/run.mjs --update` to pin the new SQL, and commit the golden.

No step touches the service.

## Before you open a PR

```
npm run check     # typecheck, validate spec/examples, dry-run compose
npm run build     # rebuild runtime/dist (commit it: the Python toolset vendors it)
node evals/run.mjs
scripts/no-real-ids.sh
(cd template && npm ci && npm run build && npm test)
```

Add a line under `## Unreleased` in `CHANGELOG.md`. Releases are tagged `kit-vX.Y.Z`; see `RELEASING.md`.

CI composes every example against the sandbox tenant; a version landing `invalid` fails the build.

## Do not

- Add a charting library, a CDN script, storage, or a network call — the host CSP blocks them and validation fails.
- Read `window.location`, `localStorage` or cookies in the runtime; it runs in an opaque-origin frame.
- Put tenant data, tokens or signed URLs in fixtures or specs.
- Edit `template/` to add features; features go in recipes. (The template's `src/studio/` client, `bda.fn` included, is the exception: it is the app-side contract with the host, versioned with the kit.)
- Change query ids or parameter names (`entity`, `from`, `to`); the runtime and the Python port depend on them.
