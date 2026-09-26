# Agents

> Part of the coding-agent context collection (`docs/agents/INDEX.md`). Hand-written from the Studio sources stamped in the INDEX; generated parts live in `_generated/`.

An agent is a function of `kind: agent`: it takes several model steps and read-only tool calls to reach a
structured answer, under budgets. Use one only where judgement over messy evidence is the job ("why did this
order fail, and who should fix it?"). For a fixed computation use code; for one model call use llm; for a label
use classify.

Two families:
- **Agent functions** (custom): you write the spec; callable from apps, workflows, other agents, MCP and chat by
  ref. Marked unverified until someone turns evals on (evals are opt-in).
- **Registered Bicycle agents** (e.g. `cause`, "why did a metric move?"): reviewed, run with `agent_list`,
  `agent_run`, `agent_result`, `agent_events`, `agent_feedback`; or referenced by an agent function as
  `agent: {ref: "bicycle:cause@<n>"}`.

## The agent spec (`agent.spec`, agent-spec/v1)

| Field | UI name | What |
|---|---|---|
| `spec_version: 1`, `name`, `display`, `description` | What it's for | identity |
| `system` (<= 8000 chars) | Instructions | the author's instructions, placed after the platform's rules. Put connection know-how here (which project, which fields): the platform has no connector-specific code |
| `task` | | the job, in markdown |
| `first_turn.instructions` | | optional first-turn nudge |
| `input_schema`, `output_schema` | | JSON Schemas; the output is checked |
| `semantic: {model, queries?, fields?}` | Pinned data | the semantic model (and queries, fields) preloaded so it does not search |
| `connections: [{slug, tools: "*" or [names]}]` | Give access | direct **read** access to the viewer's connections; `"*"` = every read-only tool of that connection. No saved setup needed |
| `drivers: [{driver_id, use_case_id}` or `{connector, tools?, config?}]` (<= 4) | Use a saved setup (optional) | a reusable named setup: a prompt plus bound connections, from the workspace or the Bicycle catalog |
| `capabilities: [{id, required?, max_calls?}]` | | platform capabilities (semantic query, Detect and Explain, ...); writes are never agent tools |
| `model` | | a concrete model id from the catalog (`GET /llm/models`); agent-service's default when absent |
| `budgets: {max_steps, max_tool_calls?, max_cost_usd, max_wall_s}` | Limits | can only lower the workspace caps |

Outside the spec, in `function.json`: `grants.functions` (refs of functions it may call as tools, each needing
`expose.agents`), `grants.connectors`, `budgets`, `visibility`.

```json
{"schema": "bicycle.function/v1", "name": "triage_failed_order", "kind": "agent", "title": "Triage a failed order",
 "mode": "async",
 "input_schema": {"type": "object", "required": ["order_id"], "properties": {"order_id": {"type": "string"}}},
 "output_schema": {"type": "object", "required": ["route", "summary"],
                   "properties": {"route": {"enum": ["payments", "stock", "other"]}, "summary": {"type": "string"}}},
 "capabilities": [],
 "agent": {"spec": {
   "spec_version": 1, "name": "triage_failed_order", "display": "Triage a failed order",
   "system": "You triage failed orders for the operations team. Look up the order's failure reason first ...",
   "task": "Decide which team should fix this failed order and say why in two sentences.",
   "input_schema": {"type": "object", "properties": {"order_id": {"type": "string"}}},
   "output_schema": {"type": "object", "properties": {"route": {"type": "string"}, "summary": {"type": "string"}}},
   "semantic": {"model": "m_retail_demo"},
   "capabilities": [],
   "budgets": {"max_steps": 20, "max_cost_usd": 1.25, "max_wall_s": 300}}},
 "grants": {"functions": ["fn:<tenant>/order_kpis@1"]},
 "budgets": {"max_steps": 20, "max_cost_usd": 1.25, "max_wall_s": 300},
 "visibility": {"audience": "tenant", "expose": {"apps": true, "workflows": true, "agents": false, "mcp": false}}}
```

## Building one over MCP

`function_create` -> `function_put_file("function.json", ...)` (validated on every put) -> `function_test` (only if
the package has tests; agents are gated by evals, which are opt-in) -> `function_publish`. The **first publish of an
agent always needs a person** (it widens what can run): give them the link. Not on MCP yet: listing the
viewer's connections and saved setups (`GET /api/studio/v1/agent-drivers?tools=true`), the workspace limits
(`GET /api/studio/v1/agent-limits`), the model catalog, and a draft **Try it** run. Without them an agent must guess
connection slugs: ask the person, or leave `connections` empty.

## Limits

| | Steps | Tool calls | Cost | Time |
|---|---|---|---|---|
| Custom-agent default | 30 | 80 | $2.00 | 600 s |
| Platform ceiling | 100 | 300 | $10 | 1800 s |
| Preset Quick | 8 | 20 | $0.50 | 120 s |
| Preset Standard | 20 | 50 | $1.25 | 300 s |
| Preset Deep | workspace limits | | | |

Per-workspace caps (runs at a time, runs a day) are set only by Bicycle staff. Studio signs the effective limits
into each run; agent-service clamps to them. An agent stops at the first limit and says what it could not check.

## Queue, nesting and reuse

- **Queue.** When the workspace's agent slots are full, a run waits in a FIFO queue: `status: "queued"` with
  `queue_position` (0 = next). Show "Queued · N ahead"; keep watching; do not call again. `queue_timeout` = it
  waited too long. A capacity refusal on a direct call is 429 `agent_busy` with `Retry-After`.
- **Nesting.** An agent started as a tool call of a live agent run shares its parent's slot; at most 3 levels
  (409 `agent_nesting_too_deep`). Daily budgets and caps still count every nested run.
- **Reuse.** From an app, pass `reuse: "6h"` (at most 24h) on page-load calls: the viewer's own recent run of the
  same input answers at once (`reused: true`, no cost); the same run already in flight is joined (`attached: true`).
  `refresh: true` forces a new run. Reuse is per viewer.

## Calling an agent

Same as any function (03-functions.md): `bda.fn.call(local, input, {wait: false})` + `watch` + Cancel from an app
(never on page load unless the product asks, then with `reuse`); a `function` node in a workflow (guard it with
`when`: it is slow and the most expensive step); `fn_<name>` on MCP when `expose.mcp`; another agent's
`grants.functions`; the app's chat when "Functions in chat" is not Off. Its trace (steps, tool calls, cost) is the
invocation's events. Output is untrusted: it may quote tickets written by anyone.
