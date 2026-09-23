# Data app kit

The way Bicycle data apps are created. Two paths exist: **compose from a spec** (default—no code required) or **hand-build from `template/`** (when a recipe cannot express what you need).

## Two ways to build a data app

**Compose from a spec (recommended).** Load `skills/ask-show-ship/SKILL.md`, interview a user to produce a `DataAppSpec`, validate and compose it with `kit compose` or the `design_*` tools on the bicycle-studio MCP. The runtime reads the spec; no per-app code.

**Hand-build from `template/`** (escape hatch). Engineers who need something the recipes cannot express start here. Rules and patterns are in `template/README-FOR-AGENTS.md`.

## Repository layout

```
spec/             dataapp-spec.v2.schema.json + examples (retail-orders-health, checkout-test-report)
recipes/          core recipes: recipe.json + Render.tsx (work on any model)
recipes/datasets.json         core queries, declared (no SQL in code)
families/         analysis families (ab_test): family.json + recipes + datasets.json
families/*/datasets.json      queries for each family
templates/        recipe lists per persona (core/ + family overrides)
profiles/         example tenant profiles (fixtures only; real profiles in the API)
runtime/          data-driven app: spec.ts, core.ts, analysis.ts, ui.tsx, App.tsx
runtime/dist/     build output: app.js, app.css (vendored by bicycle-studio-api)
compose/          CLI tool: validate, resolve, render, bundle, diff
compose/cli.mjs   kit commands: validate, compose, brief, manifest, extract, diff, catalogue
compose/diff.mjs  typed spec diff (`kit diff`) — see README's `## Diff`
evals/            golden manifests + transcript fixtures
skills/           ask-show-ship SKILL.md (published by MCP as prompt + resource)
template/         hand-build starter (React boilerplate; see template/README-FOR-AGENTS.md)
scripts/          no-real-ids.sh (guards against real customer data)
```

## kit CLI commands

- `kit validate <spec.json>...` — schema + semantic checks
- `kit compose <spec.json> [--out DIR]` — produce bundle.zip
- `kit brief <spec.json> [--out DIR]` — derive exec brief spec and compose it
- `kit manifest <spec.json>` — print the derived bda.manifest.json
- `kit extract <app.js>` — print the spec embedded in a bundle
- `kit diff <a.json> <b.json> [--json]` — typed diff between two specs, in words (see `## Diff`)
- `kit catalogue` — list recipes, templates, families as JSON

## Diff

Versions of an app are versions of its spec. `compose/diff.mjs` exports `diffSpecs(a, b) -> { changes: Change[] }`; `kit diff a.json b.json` prints one line of `change.text` per change (`--json` prints the `Change[]` instead). The Python service's `GET /versions/{a}/diff/{b}` produces the same shape from the same two rules, and the host renders `change.text` — never the raw spec. This section is that contract; the Python port copies it verbatim, so a wording or logic change here is a change there too.

Both specs are run through `resolveSpec` first (so template slots, defaulted `words`/`rules`/`theme`/`controls`, and panels are accounted for), then through a small normalization step that fills the schema defaults `validate.mjs` does not materialize (`time.column`/`time.grain`, each measure's `format`/`good`/`role`, `entity.type`, an `ab_test` family's `arms.exclude`, `chat.anchors`) — otherwise an explicit default and an omitted one would diff as a change. `appId`, `model` and `version` are never diffed: they are the app's deployment identity, not its content.

```ts
type Change = {
  kind: string        // one of the kinds below
  path: string         // where in the resolved spec, e.g. "/panels/2/bind/by", "/rules/confidence_bar"
  before?: unknown      // omitted when the change is a pure addition
  after?: unknown       // omitted when the change is a pure removal
  text: string          // the one-line human rendering — what the host shows
}
```

### Panel identity

Panels are matched across versions by **recipe**, plus — only when that recipe repeats within one spec — the bind key a `datasets.json` declares as that recipe's repeat key (trend's `by`; see `by_time_{{each_slug}}`'s `repeat` in `recipes/datasets.json`), falling back to the panel's `say` when no such key is declared. A recipe that appears once on each side is matched by recipe alone, so a change to *any* of its bind values — including a repeat-eligible key like `by` — surfaces as one `binding_changed`, not a removal and an addition. A recipe that repeats (two `trend` panels, one `by: region` and one `by: category`) is matched per distinct target, so each stays its own panel across versions.

Matched panels, additions and changes are emitted in the *after* spec's panel order; removals that have no match trail at the end, in the *before* spec's order. Measures, dimensions and controls follow the same rule (matched by `id` / `field` / `kind` (+`dim` for a `filter`), after-order then leftover removals).

### Change kinds

One example `text` each. Marked rows are produced by one of the five pairs in `evals/diff.golden.json`; the rest (a kind the fixtures don't happen to exercise — no pair changes `time.grain` or `entity`, for instance) are illustrative but rendered by the same code path.

| `kind` | Fires on | Example `text` | In goldens? |
|---|---|---|---|
| `panel_added` | a panel present only in the after spec | `added "Verdict" - "Is the refund rate within target?"` | yes |
| `panel_removed` | a panel present only in the before spec | `removed "Ranking" - "Which regions have the best and worst refund rate?"` | yes |
| `panel_changed` | a matched panel's `say` or `width` differs | `now asks "Which regions refund most?" (was "Which regions and channels carry the volume?")` | yes |
| `binding_changed` | a matched panel's `bind` differs, one entry per changed key | `Orders over time now splits by Channel instead of Region` (trend's `by`, single-panel case); goldens show the generic form: `Breakdown dims: Region and Channel -> Region` | yes (generic form) |
| `measure_added` | a measure id present only after | `added measure "Refunded orders"` | yes |
| `measure_removed` | a measure id present only before | `removed measure "Revenue"` | yes |
| `measure_changed` | a matched measure's `label`/`column`/`format`/`good`/`role` differs | `Orders is no longer the primary measure` | yes |
| `dimension_added` | a dimension field present only after | `Region is now available to cut by` | no |
| `dimension_removed` | a dimension field present only before | `Customer tier is no longer available to cut by` | yes |
| `dimension_changed` | a matched dimension's `label` differs (not in the original kind list; added rather than dropping a real change — see below) | `"Region" is now called "Area"` | no |
| `control_added` | a control present only after | `viewers can now narrow by Region` | yes |
| `control_removed` | a control present only before | `viewers can no longer change the heatmap axes` | yes |
| `control_changed` | a matched control's other fields differ | `narrow by Region: default emea, amer -> emea` | no |
| `rule_changed` | any `rules` field, or a `rules.targets` entry | `minimum bookers to include a segment: 0 -> 2500`; also `confidence bar 90% -> 95%` (illustrative — no pair changes it) | yes (min_bookers, targets, targets_blob) |
| `words_changed` | a `words` entry | `"NIBPD" is now called "Extra bookings / day"` | yes |
| `time_changed` | `time.column`/`from`/`to`/`grain` | `now weekly instead of daily` (grain) | no |
| `entity_changed` | any field of `entity` (including `entity.list.*`) | `entity label: Test -> Route` | no |
| `family_changed` | any field of `family` (`arms.*`, `roles.*`, `context.*`) | `family context start removed (was test_start)` | yes |
| `store_changed` | `store.cache` or a `store.blobs` entry | `the app can now read the "targets" blob: Refund-rate target per measure, set by the PM; the verdict compares against it.` | yes |
| `chat_changed` | `chat.enabled` or `chat.anchors` | `chat is now available to viewers, anchored to panel, selection` | yes |
| `theme_changed` | `theme.accent`/`follow` | `accent color: purple -> coral` | yes |
| `title_changed` | `title` | `title: "Retail Orders Health" -> "Retail Refund Watch"` | yes |
| `decision_changed` | `decision` | `decision: "Where does the lift live?" -> "Tell me in one line whether the treatment is winning, and which market is carrying it."` | yes |
| `template_changed` | `template` | `now uses the "explorer" template (was "report")` | yes |
| `persona_changed` | `persona` (not in the original kind list — see below) | `now built for the analyst (was the PM)` | yes |

`persona_changed` and `dimension_changed` are additions to the kind list this task started from: `checkout-test-report -> checkout-test-explorer` genuinely changes `persona` (`pm` -> `analyst`), and a spec can legitimately rename a dimension's label without changing its field. Dropping either would silently swallow a real spec change, so they were added rather than folded into an existing kind or discarded. Every other kind in the original list is produced by at least one of the five golden pairs.

Object-keyed sections sort their keys for determinism: `words`, `rules.targets`, `store.blobs` (by name), and a panel's or control's changed bind/field keys.

## The frame <-> host protocol

The frame is sandboxed without `allow-same-origin`, so it never fetches: every
capability is a `postMessage` to the parent. This is the whole wire.

| Direction | Message | Carries | Declared in |
| --- | --- | --- | --- |
| frame -> host | `studio:sandbox:query` | `requestId`, `queryId`, `options` (parameters, filters, sort, limit) | `runtime/src/studio/client.ts` |
| host -> frame | `studio:sandbox:query-result` | `requestId`, `ok`, `result` \| `error` | `runtime/src/studio/client.ts` |
| frame -> host | `studio:sandbox:store` | `requestId`, `op` (`cache.get`/`set`/`delete`, `blob.get`/`list`), `key`/`name`/`value` | `runtime/src/studio/store.ts` |
| host -> frame | `studio:sandbox:store-result` | `requestId`, `ok`, `result` \| `error` | `runtime/src/studio/store.ts` |
| frame -> host | `studio:sandbox:context` | `panels[]` (`panelId`, `recipe`, `say`, `bind`, `selection?`, `digest?`, `kind?`, `threadId?`, **`status`**, `rect`), `tokens` | `runtime/src/studio/contextRegistry.ts` |
| host -> frame | `studio:sandbox:highlight` | `panelId` | `runtime/src/studio/contextRegistry.ts` |
| frame -> host | `studio:sandbox:analysis` | `requestId`, `action` (`run` with `analysisId`, `window?`, `baselineWindow?`, `filters?`; `unwatch`; `cancel` with `jobId`) | `runtime/src/studio/analysis.ts` |
| host -> frame | `studio:sandbox:analysis-result` | `requestId`, `ok`, `job?` (JobStatus), `result?` (findings + drivers), `error?`, `final` — repeated on every job move | `runtime/src/studio/analysis.ts` |
| frame -> host | `studio:sandbox:agent-run` | `requestId`, `action` (`start` / `get` / `cancel` / `feedback`), `agentId`, `findingKey`, `subjectKey?`, `jobId?`, `subject?`, `row?`, `panelId?`, `rerun?`, `runId?`, `verdict?`, `causeIds?`, `note?` | `runtime/src/studio/agentRun.ts` |
| host -> frame | `studio:sandbox:agent-run-result` | `requestId?` (absent on a push), `ok`, `findingKey`, `subjectKey`, `runId`, `state`, `match`, `asOf`, `run?`, `error?` | `runtime/src/studio/agentRun.ts` |
| frame -> host | **`studio:sandbox:state`** | `state` (`asOf?`, `time?`, `filters`, `section?` — only what differs from the defaults), `dropped[]` (`{ id, reason }`) | `runtime/src/studio/contextRegistry.ts` |

`studio:sandbox:context` panels may also carry **`findings[]`** (`findingKey`,
`subjectKey`, `jobId`, `subject`, `row`) — the findings a `changes` panel is
showing — and a `changes` panel's `selection` is `{ findingKey, row: { top,
height } }`, the picked finding and where its row sits in the card, so the
host's "Why?" pill can sit on that row.

### Analyses and agent runs

A spec may declare **`analyses[]`** — ad hoc Detect & Explain questions
(`id`, `kind` `detect`|`explain`, `title?`, `config`, `bind?`, `calendar?`,
`scope?`). They travel verbatim into the manifest's `analyses`; the service
owns `config`'s grammar and checks it on upload. The `changes` recipe
("What changed and why", `bind.analysis`) runs one through the host as the
viewer and shows the job's state (queued with its place in line, running,
done, failed, abandoned), then the findings keyed by `finding_key`, the
picked finding's drivers, and a `CauseCard`.

The host owns every wait: an analysis is answered on every job move until
`final`; an agent run is answered and then pushed again on every state change
while the host polls, including a run the host's own "Why?" pill started.
`useAgentRun(finding)` listens by `findingKey` and finds its run again on
reload with `get` (by finding, then by `subject_key`). `CauseCard` renders the
agent's text as text nodes only; `[fig:n]` becomes a chip with the run's
checked figure and `[n]` opens that cause's evidence. ✓ / ✗ / correct go back
as `feedback`.

Note `studio:sandbox:state` uses `kind:` where the others use `type:` — it is a
state announcement, not one half of a request/response pair.

### Panel `status` (T9.0)

Every entry of `studio:sandbox:context` says how far along that panel's own
data is, so a host waiting to capture, highlight or ask about a panel never has
to guess from whether a `digest` turned up:

| `status` | When |
| --- | --- |
| `loading` | at least one of the panel's queries is still in flight |
| `ready` | every query resolved and there is something to show |
| `empty` | every query resolved and there are no rows |
| `error` | a query failed |

A recipe that renders several cards for one panel (`kpis`' tile per measure,
`ranking`'s top and bottom tables) reports the **worst** of them — `error` over
`loading` over `empty` over `ready`. A context report is sent whenever a
panel's status changes, not only when its digest does. A card reports `empty`
only when its recipe told `widgetState(...)` how many rows it is about to draw;
one that cannot say cheaply reports `ready`, which is the safer default (a host
waits for nothing).

### Where a deep link lands (T9.0)

The host turns a link, or a scheduled capture, into one `state` object and
injects it with the rest of the embed context (`window.__BDA_CONTEXT.state`)
before the bundle loads. The runtime adopts it in `ControlsProvider`'s state
initialisers, so the **first** query already carries it — there is no "defaults
first, then the real window" pass.

```ts
state?: {
  asOf?: string                                        // ISO date; pins every query's as-of
  time?: { preset?: string; from?: string; to?: string } // a declared preset id, or an explicit ISO range
  filters?: Record<string, string[]>                   // filter id -> selected values
  section?: string                                     // section/tab id, if the app declares sections
  panel?: string                                       // panel to highlight once ready — the HOST does this; the runtime ignores it
  snapshot?: boolean                                   // presentation-only: hide the kit's interactive chrome, stop animating
}
```

- **A filter id is the `filter` control's `dim`** — the declared dimension it
  narrows (`spec.controls[].dim`), which is the only id a filter has in this
  kit's spec. Values are checked against that control's `options`.
- **`asOf` reaches the queries as the time window's upper bound.** The composer
  declares `:from` and `:to` and nothing else, so an extra `as_of` parameter
  would be refused. A **preset** (the host's, the spec's default, or one a
  viewer picks later) is computed relative to the as-of — its window ends at
  the as-of day, so `t=30d&asof=2026-06-01` is 2026-05-02..2026-06-01 whenever
  it is opened. An **explicit range** is clamped to the as-of. Either way no
  query reads past it, and the FilterBar shows the window actually queried.
- **Dates must be real calendar days.** `asOf`, `from` and `to` are
  `YYYY-MM-DD` and are validated by round-trip, so `2026-02-31` is dropped
  (`invalid_date`) rather than rolled over into March.
- **`section` is carried, not rendered.** This kit's spec declares no sections
  yet; it round-trips in `studio:sandbox:state` so a host that does declare
  them keeps its link intact.
- **Unknown filter ids and values a filter does not offer are dropped**, never
  applied, and each one is named in `dropped` — a bad link says so instead of
  quietly showing a different app.

`dropped` entries name the deep-link parameter and why; the host writes its own
sentence from the pair. One entry per `id` + `reason`, however many values
tripped it:

| `id` | `reason` | When |
| --- | --- | --- |
| `f.<dim>` | `unknown_filter` | no `filter` control narrows `<dim>` |
| `f.<dim>` | `invalid_value` | a value the filter does not offer, or a second value for a single-select filter |
| `t` | `undeclared_preset` | a preset id the `time` control does not declare |
| `t` | `invalid_date` | a range missing an end, or an end that is not a real `YYYY-MM-DD` day |
| `asof` | `invalid_date` | not a real `YYYY-MM-DD` day |
| `s` | — | reserved; `section` is carried, not checked, so nothing drops it today |

What the frame actually adopted comes straight back:

```ts
{ kind: "studio:sandbox:state",
  state: { asOf?: string; time?: { preset?: string; from: string; to: string }; filters: Record<string, string[]>; section?: string },
  dropped: { id: string; reason: "unknown_filter" | "invalid_value" | "undeclared_preset" | "invalid_date" }[] }
// e.g. dropped: [{ id: "f.channel", reason: "unknown_filter" }, { id: "t", reason: "undeclared_preset" }]
```

**Defaults are not state.** `state` carries only what differs from the app's
defaults, so the host can write it straight into the URL and an untouched view
stays the bare URL: a filter equal to its seed (the control's `default`, or all
its options) is left out of `filters` (compared as a set); `time` is left out
when it is the default window (the `time` control's default preset — computed
relative to `asOf` when there is one — or the spec's own range when it
declares none); `asOf` and `section` appear whenever they are set. An untouched
view reports `{ filters: {} }` — the message is always sent, so the host knows
the state was applied.

Sent once after the initial state is applied — before the first (debounced)
context report — and again on every change a person makes in the FilterBar, the
time controls or the section. `dropped` describes the initial state and does
not change, so every message repeats it rather than the host having to remember
the first one.

`snapshot: true` adds `kit-snapshot` to the document root, and `theme.css` does
the rest: the provenance "How is this computed?" affordance and the summary
panel's expand toggle are hidden, and transitions and animations stop. Nothing
is rendered conditionally — the DOM a capture sees is the DOM a viewer sees —
and the filters stay on screen, because a capture has to show what was applied.

For `npm run dev`, where there is no embed page, set
`window.__BDA_RENDER_STATE` in `runtime/public/dev-spec.js` instead.

## npm scripts (root)

```bash
npm run build      # typecheck + vite build runtime/dist + assert output names
npm run typecheck  # tsc --noEmit
npm run check      # typecheck + validate specs + dry-run compose one example
npm run compose    # alias for node compose/cli.mjs
npm run dev        # vite watch (runtime only, for development)
```

## How bicycle-studio-api vendors this kit

The API reads this repository's release tag (e.g. `v1.0.0`) and:

1. Copies `runtime/dist/` (app.js, app.css) into its bundles
2. Flattens `recipes/` and `families/*/` into JSON catalogues
3. Embeds `spec/dataapp-spec.v2.schema.json`, templates, and `skills/ask-show-ship/SKILL.md`
4. Uses `compose/datasets.mjs` (the dataset renderer) to substitute query parameters

**Release rule:** Tag the kit repo → re-vendor into the API from that tag → publish the MCP skill from the same tag. They are one release unit.

## Invariants and rules

Before changing anything here, read `AGENTS.md` for the full rules. Quick version:

- The spec is a public contract (`spec/dataapp-spec.v2.schema.json`).
- No SQL in code — queries live in `recipes/datasets.json` and `families/*/datasets.json`.
- Model-agnostic — nothing in recipes, templates, runtime, or compose may name a model, metric, or dimension.
- Public repo — no real customer data anywhere (`scripts/no-real-ids.sh` guards it).
- Query ids are derived, not authored. Core: `entity_list`, `totals`, `by_time`, `by_dimension`, `by_time_<dim>`. `ab_test`: `entity_list`, `experiment_meta`, `arm_totals`, `segments`, `daily_trend`.
- The runtime emits exactly `app.js` and `app.css` (other names cause validation to fail).
- Components use `--bda-*` CSS tokens only; colours live in `runtime/src/theme.css`.
- Specs compose to ≤32 queries. Core specs use 2–6; `ab_test` specs use 5.

See `AGENTS.md` for the full list and details.

## Running checks locally

```bash
# At the root
npm ci
npm run build
npm run check      # includes node evals/diff.mjs
node evals/run.mjs
scripts/no-real-ids.sh

# For the hand-build starter
cd template
npm ci
npm run build
npm test
```
