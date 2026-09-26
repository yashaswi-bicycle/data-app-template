# Functions

> Part of the coding-agent context collection (`docs/agents/INDEX.md`). Hand-written from the Studio sources stamped in the INDEX; generated parts live in `_generated/`.

A function is a named, versioned, declared unit of work that Studio runs for any caller (an app, a workflow, an
agent, MCP, chat, REST) as one invocation with one trace. It has an `input_schema`, an `output_schema`, and lists
every capability it needs; nothing unlisted is reachable.

## Kinds

| Kind (UI name) | What it is | Package | Typical time and cost |
|---|---|---|---|
| `code` (Code) | Python `def handler(input, ctx) -> dict` on `bda-python:3` in a gVisor sandbox | `function.json`, `main.py`, `tests` (required) | < 1 s to a few s warm; a cold start adds seconds; compute units only |
| `llm` (Ask AI) | one structured model call | `function.json` with `llm: {model, prompt, system?, effort?, max_output_tokens?, on_invalid?, max_cost_usd?}`, `prompts/*.md` using `{{input/<pointer>}}` | 1-10 s, cents |
| `classify` (Sort into categories) | one text field into a closed label set | `classify: {labels, multi_label?, instructions?, text_field}` | < 2 s, a fraction of a cent |
| `agent` (Agent that investigates) | several model steps and read-only tool calls under budgets | `agent: {spec}` (or `{ref: "bicycle:<agent>@<n>"}`), `grants`, `budgets` | 30 s to minutes, cents to about a dollar; always async (04-agents.md) |
| `lookup` | **retired**. Never create one: read a connection with an agent that has access to it | | |

The kind cannot change after creation; a different kind is a new function. Full field list:
`_generated/function-manifest.md`.

### Code capabilities (`capabilities[]`)

| id | Lets the code | Config |
|---|---|---|
| `semantic.query` | run declared semantic queries | `queries` |
| `cache.read` / `cache.write` | read / write its own cache | `names`, `ttl_max_s`, `max_value_bytes` |
| `blob.read` / `blob.write` | read / write named blobs (a workflow's blobs when called from one) | `names` |
| `llm.call` | call a model from the tenant allowlist | `models`, `max_calls`, `max_usd` |
| `fn.call` | call other functions (depth <= 3) | `refs` |

Sends are never a capability: they are workflow send steps.

### Visibility

`visibility.audience`: `private` | `app` | `tenant` | `bicycle`. `visibility.expose`: `apps`, `workflows`,
`agents`, `mcp` (booleans). Turning on `agents` or `mcp`, or widening the audience, is a widening change a person
confirms.

## The loop over MCP

```text
function_create(name, title, app_id?)                 # name ^[a-z][a-z0-9_]{0,55}$; app_id makes it app-local
function_put_file(name, "function.json", <manifest>)  # every put makes a new version and the runtime validates it
function_put_file(name, "main.py", <code>)            # or prompts/*.md for llm
function_test(name, n)                                # the package's tests on the real executor, fixtures only
function_publish(name, n)                             # code-only change: publishes; anything wider: a link for a person
function_versions(name) / function_list(app_id?)
```

- A zip works too: `function_upload_url` -> PUT -> `function_complete_upload`.
- `function_publish` of a first version, a new capability, model, query, audience, MCP exposure, a bigger class or a
  doubled timeout answers **"A person must confirm this in Studio before vN ..."** with
  `/<company>/apps/functions/<name>?publish=vN`. That is not an error: give the person the link and wait.
- Not on MCP yet: reading one function (`GET /functions/{name}`),
  a draft **Try** run of an llm/agent function, changing `expose` or audience on the record, disable/enable
  (`POST /functions/{name}:disable|:enable`), dependents (`GET /functions/{name}/dependents`), the model catalog
  (`GET /llm/models`), the function kinds (`GET /function-kinds`), the Bicycle library (`GET /function-library`).

## Calling a function

| From | How |
|---|---|
| A data app | `manifest.functions` + `bda.fn.call(local, input)` (02-data-apps.md; generated examples in `_generated/function-usage-examples.md`) |
| A workflow | a `function` node with `ref: fn:<tenant>/<name>@<n>` (needs `expose.workflows`) |
| An agent | add the ref to the agent's `grants.functions` (needs `expose.agents`) |
| MCP | `fn_<name>` (needs `expose.mcp`); long calls return an invocation id: `functions_result(invocation_id, wait_s)` |
| Chat | the app's imports exposed to agents, when "Functions in chat" is not Off |
| REST | `POST /api/studio/v1/functions/{ref}:invoke` (sync kinds) or `:submit` (async), then `GET /invocations/{id}` |

Every call is an invocation (06-invocations-and-traces.md). Output is untrusted data.

## Disable (soft delete)

Deleting a function is **disable**: pinned callers keep working, new uses answer
409 `function_disabled`, it leaves every picker, and a Disabled tab lists it; Enable restores it. Owners and admins
only. There is no hard delete. Check dependents first and tell the person what uses it.

## Worked example: a KPI code function

```json
{"schema": "bicycle.function/v1", "name": "order_kpis", "kind": "code", "title": "Order KPIs for a day",
 "entrypoint": "main:handler", "image": "bda-python:3", "mode": "async", "timeout_ms": 10000,
 "resources": {"class": "fn-xs"},
 "input_schema": {"type": "object", "required": ["day"], "properties": {"day": {"type": "string"}}},
 "output_schema": {"type": "object", "properties": {"orders": {"type": "number"}, "failed_pct": {"type": "number"}}},
 "capabilities": [{"id": "semantic.query", "queries": ["orders_by_day"]}],
 "visibility": {"audience": "tenant", "expose": {"apps": true, "workflows": true, "agents": false, "mcp": false}},
 "tests": [{"name": "one day", "input": {"day": "2026-09-20"}, "fixtures": {"orders_by_day": "fixtures/day.json"},
            "expect": {"orders": 120}}]}
```

```python
# main.py
def handler(input, ctx):
    res = ctx.query("orders_by_day", {"from": input["day"], "to": input["day"]})   # a QueryResult
    rows = res.records()
    orders = sum(r["orders"] for r in rows)
    failed = sum(r["failed_orders"] for r in rows)
    return {"orders": orders, "failed_pct": round(100 * failed / orders, 2) if orders else 0}
```

**Where `orders_by_day` comes from.** `semantic.query` names query ids; the SQL is declared by the **calling
deployment** (the app's `bda.manifest.json` `queries`, or the workflow's `queries` block), and Studio's broker
runs it against that deployment's model. A tenant function carries no SQL of its own, so the app or workflow that
calls it must declare every query id it lists (else `capability_not_granted`). This is easy to miss.

The handler's `ctx` (bicycle-fn-sdk, standard library only, no pip): `ctx.query(id, params, max_rows=)`,
`ctx.cache.get/set/delete`, `ctx.blob.get/put/list`, `ctx.llm(model, ...)`, `ctx.call(ref, input)`,
`ctx.log(msg)`, `ctx.progress(pct, note)`, `ctx.deadline_ms()`, `ctx.remaining_ms()`; `ctx.agent` is reserved.
An ungranted capability raises `CapabilityError(code="capability_not_granted")`.
