# Connecting to the Studio MCP

> Part of the coding-agent context collection (`docs/agents/INDEX.md`). Hand-written from the Studio sources stamped in the INDEX; generated parts live in `_generated/`.

## URLs (preview)

| URL | Carries |
|---|---|
| `https://preview.bicycle.ai/mcp` | every enabled toolset except `chat` |
| `https://preview.bicycle.ai/mcp/<toolset>` | one toolset: `dataapp`, `query`, `design`, `analysis`, `workflow`, `agent`, `functions`, `function`, `notebook`, `chat` |

Prod is `https://app.bicycle.ai/...`. Build and test on preview.

Every path answers 401 with `resource_metadata=https://preview.bicycle.ai/.well-known/oauth-protected-resource/mcp`.
Studio's MCP is stateless: each POST is its own connection. Long work returns an id at once and you poll
(`functions_result`, `workflow_run_describe`, `agent_result`, `analysis_result`); `fn_*` calls stream progress when
the client sends a `progressToken`.

## Two ways to authenticate

| | OAuth (Claude desktop connector, `claude mcp add` without a header) | Platform API token |
|---|---|---|
| How | Authorization server `https://preview.bicycle.ai/api/oauth` (authorization code + PKCE S256, Client ID Metadata Documents; no dynamic client registration) | a person creates a token (role API) in Bicycle, then `claude mcp add --transport http bicycle-preview https://preview.bicycle.ai/mcp --header "Authorization: Bearer $TOKEN"` |
| Scopes today | `apps:read apps:write apps:publish` only | editor scopes including `functions:*` |
| You see | `dataapp_*`, `query_*`, `design_*`, `analysis_*`, `workflow_*`, `agent_*`, `notebook_*` | all of those plus `function_*`, `functions_result`, `fn_*`, `wf_*` |

**If you see no `function_*` or `fn_*` tools, you are on OAuth.** The OAuth consent does not offer the
`functions:*` scopes yet. Tell the person; do not try other routes.

`tools/list` is filtered per caller: a tool whose scope you lack is not listed, and the same scope is checked
again when you call it.

## Scopes

| Scope | Lets you |
|---|---|
| `apps:read` | read apps, run queries, read workflows, run Detect and Explain and registered agents (as you) |
| `apps:write` | create apps and versions, create/patch/run workflows, schedules for others |
| `apps:publish` | publish apps and workflows (gated changes still need a person) |
| `functions:read` / `functions:write` / `functions:publish` | list, author and test, publish functions (widening publishes need a person) |
| `functions:invoke` | call `fn_*` / `wf_*` tools, read results |

## Toolsets at a glance

| Toolset | Prefix | For |
|---|---|---|
| dataapp | `dataapp_` | create, upload, validate, publish, share apps; schedules; ask an app's chat; `dataapp_sdk` |
| query | `query_` | the semantic catalog and cache-only semantic SQL |
| design | `design_` | compose an app from a spec by interview (skill `studio://skill/ask-show-ship`) |
| function | `function_` | author, validate, test, publish functions (all kinds) |
| functions | `fn_<name>`, `wf_<slug>`, `functions_result` | call published functions and workflows exposed to MCP |
| workflow | `workflow_` | build, plan, publish, run workflows (skill `studio://skill/workflow`) |
| agent | `agent_` | run **registered Bicycle agents** (e.g. `cause`) and read results; agent *functions* are called as `fn_<name>` |
| analysis | `analysis_` | ad hoc Detect and Explain |
| notebook | `notebook_` | notebooks (not needed for data apps) |
| chat | `fn_<local>`, `chat_result` | what a chat may call; used by Bicycle's own chat agents, not by you |

Entry points today: resources `studio://skill/ask-show-ship`, `studio://skill/semantic-query`,
`studio://skill/workflow`, `studio://skill/notebook`, `studio://recipes`, `studio://templates`; prompts
`design-data-app`, `build-workflow`, `build-notebook`; tools `workflow_guide`, `notebook_guide`. Start with
`studio_guide` when your connection lists it; otherwise start with this collection (`docs/agents/INDEX.md`).
