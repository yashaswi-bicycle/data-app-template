# Data apps: the kit, the template and the manifest

> Part of the coding-agent context collection (`docs/agents/INDEX.md`). Hand-written from the Studio sources stamped in the INDEX; generated parts live in `_generated/`.

A data app is a small web bundle (`app.js`, `app.css`, `bda.manifest.json`) that Studio hosts in a sandboxed
frame, bound to **one semantic model**. It reads data only through queries it declares; Studio runs them.

## Two ways to make one

| | Compose from a spec (default) | Hand-build from `template/` |
|---|---|---|
| What you write | a DataAppSpec v2 (JSON): measures, cuts, questions, filters | React + TypeScript in `template/src`, and `bda.manifest.json` |
| Queries | derived by the composer; no SQL | you declare semantic SQL in the manifest |
| Tools | `design_model_card`, `design_recipes`, `design_templates`, `design_recipe_preview`, `design_spec_validate`, `design_compose`, `dataapp_publish` | `query_*`, `dataapp_start`, `dataapp_upload_url`, `dataapp_complete_upload`, `dataapp_publish` |
| Skill | `studio://skill/ask-show-ship` (the template's `skills/ask-show-ship/SKILL.md`) | `template/README-FOR-AGENTS.md` + `studio://skill/semantic-query` |
| Calls functions, agents, workflows | **not yet** (the kit runtime has no `bda.fn`) | yes, with `manifest.functions` + `bda.fn` |

Use compose unless the app must call a function, agent or workflow, or needs something no recipe draws.

## The hand-build loop

```bash
git clone https://github.com/BicycleAI/data-app-template.git my-app && cd my-app/template && npm install
```

1. `dataapp_start(name, title, model)` -> `appId`, version 1 awaiting upload. Put `appId` in `bda.manifest.json`.
2. Explore the model and prove each query with `query_run` (read the model's `from`/`till` window first).
3. Declare queries in `bda.manifest.json` (`id`, `sql`, `parameters`, `columns`, `maxLimit`; at most 32). Rules:
   `template/README-FOR-AGENTS.md` and `studio://skill/semantic-query` (metrics are columns, bounded time range,
   no JOIN, no OR, no semicolons).
4. Declare imports (functions, agents, workflows) under `functions` (below).
5. `npm run build` (typechecks; emits exactly `dist/app.js`, `dist/app.css`), zip `bda.manifest.json` + those two at
   the zip root.
6. `dataapp_upload_url(app_id, version)` -> resumable PUT -> `dataapp_complete_upload(app_id, version, sha256, bytes)`.
   The server compiles every declared query and boots the bundle; the version is `validated` or `invalid` with
   per-query errors.
7. `dataapp_publish(app_id, version)`. A later change: `dataapp_new_version(app_id)` and repeat 5-7. Versions are
   private drafts until published.

## `bda.manifest.json`

The full field list is generated: `_generated/app-manifest.md` (`extra=forbid`: an unknown field fails the upload).
The fields a coding agent uses most:

| Field | What |
|---|---|
| `queries` | declared semantic SQL, at most 32 |
| `functions` | imports: `{"<local_name>": {"ref": "fn:<tenant>/<name>@<n>"}}` or `{"ref": "wf:<tenant>/<slug>@<n>"}`; at most 16; `{ref}` only (no `description`) |
| `chat` | `{enabled: true, anchors: [...]}`; chat is on by default and is drawn by the host, never by the app |
| `views.tabs` | tabs a schedule or workflow snapshot can capture |
| `analyses` | declared Detect and Explain analyses (07-detect-explain.md) |
| `cache`, `blobs` | declared persistence; anything undeclared is refused (`store_not_declared`) |
| `calendar` | the app's timezone and week start (windows, schedules) |
| `agents` | older app-declared agents with connector grants; prefer an **agent function** imported under `functions` |
| `lookups` | **retired**; never add one |

## Calling a function, agent or workflow from the app: `bda.fn`

> The `bda.fn` files ship in this template at `template/src/studio/` (`fn.ts`, `bda.ts`, `fn.test.ts`, kit 1.1.0).
> Studio serves the same files over MCP `dataapp_sdk` and `GET /api/data-apps/sdk`.

`src/studio/fn.ts` and `src/studio/bda.ts` sit next to the template's `src/studio/types.ts`. Declare the import,
then:

```ts
import { bda } from './studio/bda.js'

// quick call (code, llm, classify): waits and returns the output, or throws a BdaError in words
const out = await bda.fn.call('order_count', { day: '2026-09-20' })

// slow call (agent, workflow): start, show progress, allow Cancel
const started = await bda.fn.call('triage_failed_order', { order_id }, { wait: false })
const watch = bda.fn.watch(started.invocation_id, batch => showProgress(batch.items))
cancelButton.onclick = () => bda.fn.cancel(started.invocation_id)
const value = bda.fn.outputOf(await watch.done)

// on page load: ALWAYS reuse a recent result of the same call, and show "as of <created_at> · Refresh"
const inv = await bda.fn.call('order_count', input, { wait: false, reuse: '6h' })
```

Rules: name the local name only; start calls from a button's `onClick` (no forms in the sandbox); render output
as text; `reuse` does not apply to workflows; a workflow send is delivered only when its receipt `state` is
`"sent"`; the call runs **as the viewer** and appears in Studio's Runs with its trace. Per-function text: the
function's "Use it in an app" tab (generated examples: `_generated/function-usage-examples.md`); per workflow:
`workflow_guide(workflow_id)`.

A version that adds or re-pins an import is confirmed by a person when it is published.

## Chat in an app

Chat belongs to the host page (the "Ask AI" drawer): never build a chat UI in the app. Report what is on screen
with `<Panel>` (`components/Panel.tsx`) so chat can see each card's title, kind, `queryId` and a digest.

**Functions in chat.** The app's chat may call the app's imported functions and workflows that are exposed to
agents (`expose.agents`), as tools named `fn_<local>`, with the same invocation and trace. The owner or a tenant
admin switches it in the app's settings: *Functions in chat: Inherit / Off* (`settings.chat.functions`,
`PATCH /api/data-apps/{id}`). There is no MCP tool for this setting yet.

## Schedules and sharing

- `dataapp_schedule` creates, updates, enables, disables, deletes or runs a scheduled snapshot of one saved view,
  emailed as PNG/PDF; `dataapp_schedule_test` sends one now; `dataapp_schedule_list` reads them. On preview, email
  only allowlisted addresses.
- `dataapp_share` shares an app. A **workflow** `snapshot` step can capture only an app shared with the whole
  workspace (`snapshot_app_not_shared` otherwise).
- `dataapp_ask(app_id, question)` asks a published app's own chat; `dataapp_summary` summarises its screen.
