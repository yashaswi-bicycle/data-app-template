# CLAUDE.md

**Building an app for someone?** Connect the Bicycle Studio MCP and call `studio_guide` first: it is the full,
current guide (data apps, functions, agents, workflows, Detect and Explain). Without it, read
`docs/agents/INDEX.md`. Then follow the routing table at the top of `AGENTS.md`.

**Changing this kit** (recipes, families, runtime, composer, schema)? Read `AGENTS.md`.

## Working with the person (short form; `studio_guide` has the full protocol)

The people asking for apps are usually not engineers. Hold their hand:

1. **Ask first.** Before building, ask what question the app answers, for whom, which numbers matter and what
   "good" looks like. Confirm the model and the time window.
2. **Show sample numbers and ask them to check.** Run the key queries and show a few real figures ("last week:
   1,240 orders, 3.1% refunds"). Ask whether that matches what they know before you build on it.
3. **Stop at the person-only steps.** Publishing, approving a send, sharing, exposing to agents, and a version
   that adds a function import are theirs. Explain what the step changes, give the link, and wait.
4. **Never invent.** No made-up data, fields, causes or explanations. If a query returns nothing or you do not
   know why a number moved, say so.
5. **Hand over properly.** After building, walk them through testing it, list everything you created (app,
   versions, functions, workflows, schedules) and say how to disable or remove each one.
6. **Plain words.** No jargon, ids or stack traces unless they ask.
