# Detect and Explain

> Part of the coding-agent context collection (`docs/agents/INDEX.md`). Hand-written from the Studio sources stamped in the INDEX; generated parts live in `_generated/`.

Detect and Explain answers "what changed, and why?" on one metric of an app's semantic model, ad hoc and as the
person asking. **Detect** finds the segments (combinations of up to 4 dimensions) whose metric moved unusually in
a window. **Explain** ranks what drove a change against a baseline. `detect_and_explain` does both.

## How it runs

1. A caller (the app's analysis panel, the app's chat, or MCP) asks Studio with the app id and either a declared
   analysis or an intent.
2. Studio checks READ on the app, fills the platform fields (model / use case, windows from the app's calendar,
   cache), validates the config against the engine's closed schema, and queues a job (its own job store; not an
   invocation yet).
3. Studio calls agent-service `POST /analysis/detect` as the person (their own credential), synchronously, in a
   30-minute budget. The engine persists its result (`det_...`) and artifacts (tables).
4. Studio reads the persisted result and returns **its own normalised tables**: findings (segment, severity,
   current, baseline, % change, contribution %) and drivers (per finding, ranked). The engine's `result_id` never
   leaves Studio.
5. The same question twice joins the running job or reuses a recent answer. Runs count against the tenant's daily
   budget. A `scope: shared` declared analysis is one answer for every viewer of the app; otherwise a job is
   visible only to whoever started it.

## Over MCP

```text
analysis_describe(app_id)          # enabled?, declared analyses, the intent fields, budget used/left
analysis_run(app_id, intent={...}) # or analysis_id=<declared>, or config+kind (full engine config); returns job_id
analysis_result(job_id, wait_s=60) # call until succeeded/failed; findings and drivers as tables (max_rows <= 200)
```

Intent: `{"kpi": "<metric>", "window": "yesterday" | "last_7_days" | "last_week" | "last_month" |
{"from": "YYYY-MM-DD", "through": "YYYY-MM-DD"}, "dimensions": [<= 4 fields], "mode": "detect" | "explain" |
"detect_and_explain", "sensitivity": "low" | "medium" | "high", "direction": "both" | "drop" | "spike",
"baseline": "P7D" (explain), "filters": [{"field", "op", "value"}] (<= 8, <= 20 IN values)}`.

It needs an **app** (the app fixes the model and calendar). To analyse a model with no app, create a minimal app
bound to it first.

## In an app

- **Declared analyses**: `bda.manifest.json` `analyses: [{id, kind: "detect" | "explain", title?, config, bind:
  {window, filters}, calendar?, scope: "user" | "shared"}]` (at most 16). The host's analysis panel lists them;
  `bind` lets the viewer's window and filters apply.
- **Panel**: the host draws the analysis panel; the app does not build it.
- **Chat**: the app's chat can run Detect and Explain on the app's model.
- **REST** (for a hand-built app's backend or a script): `GET /api/data-apps/{app}/analyses`,
  `POST /api/data-apps/{app}/analyses/{id}/run`, `GET .../analyses/{id}/latest`,
  `POST /api/data-apps/{app}/analysis-jobs`, `GET .../analysis-jobs/{job}`, `GET .../analysis-jobs/{job}/result`,
  `POST .../analysis-jobs/{job}/cancel`. App code itself calls nothing directly (no network in the sandbox);
  there is no `bda` call for analyses yet.

## Why a metric moved, in words

For a narrative "why" (evidence, causes, figures), use the registered **cause** agent: `agent_run("cause",
input_json={"question": ..., "subject": {"model", "metric", "window": {"from", "through"}, "baseline":
{"shift": "P7D"}}})`, then `agent_result`. It uses Detect and Explain as one of its tools.

## In workflows: not yet

The workflow kinds `detect` and `explain` are **draft and cut from v1**: they validate and plan, but every node
partition is reported not runnable ("run it from a panel, chat or MCP"). Do not build a workflow around them.
Scheduled detection ("patterns") belongs to a separate product area and is out of scope here.
