# Bicycle Studio: context for coding agents

**Status: pending content review.** Generated on 2026-09-26 from the Studio sources below; the hand-written chapters
are drafts until each has a served source.

For a coding agent (Claude Code or similar) with this repository and a Bicycle Studio MCP connection. If your
connection lists `studio_guide`, call it first: it serves the current version of this collection. Otherwise read
in this order; each file is one topic and stands alone.

| # | File | What it covers |
|---|---|---|
| 0 | [00-start-here.md](00-start-here.md) | What you can build, which tool family does what, the golden rules, the order to work in |
| 1 | [01-mcp-connection.md](01-mcp-connection.md) | URLs, OAuth vs token, scopes, which tools you will see and why some are missing |
| 2 | [02-data-apps.md](02-data-apps.md) | Compose vs hand-build, `bda.manifest.json`, declared queries, `manifest.functions`, `bda.fn`, chat, schedules |
| 3 | [03-functions.md](03-functions.md) | Kinds (code, llm, classify, agent), `function.json`, the author/test/publish loop, calling |
| 4 | [04-agents.md](04-agents.md) | Agent functions: instructions, pinned data, connections, saved setups, limits, queue, reuse |
| 5 | [05-workflows.md](05-workflows.md) | The workflow guide (generated; the same text as MCP `workflow_guide`) |
| 6 | [06-invocations-and-traces.md](06-invocations-and-traces.md) | One `inv_` record, events, trace, statuses, Runs |
| 7 | [07-detect-explain.md](07-detect-explain.md) | Ad hoc Detect and Explain from a panel, chat or MCP |
| 8 | [08-limits-and-safety.md](08-limits-and-safety.md) | Every limit and every "a person must do this" rule in one place |

Generated reference (`_generated/`): [app-manifest.md](_generated/app-manifest.md) (the `bda.manifest.json` fields),
[app-sdk.md](_generated/app-sdk.md) (`bda.fn`), [function-manifest.md](_generated/function-manifest.md)
(`function.json`), [function-usage-examples.md](_generated/function-usage-examples.md) (Studio's "Use it in an app"
text), [workflow-kinds.md](_generated/workflow-kinds.md) (workflow node kinds).

## Source commits

Every generated file names its source and commit in its first line. This copy was built from:

| Source repository (Bicycle-internal) | Commit |
|---|---|
| bicycle-studio-api | `2b2ce80` |
| data-app-runtime | `b21a421` |
| ui-bicycle-studio | `c0eed35` |

Do not edit files here by hand: they are regenerated from those sources at each kit release (see `RELEASING.md`).

## Rules kept in this collection

- No customer model ids. Examples use `m_retail_demo`, `m_checkout_demo` or `<model>`; tenants `acme` or `<tenant>`.
- No secrets. Tokens are `$TOKEN` placeholders.
- Build and test on preview; email only addresses on the deployment's allowlist.
