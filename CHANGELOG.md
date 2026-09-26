# Changelog

All notable changes to the data-app kit (this repository: spec, recipes, runtime, composer, skills and the
hand-build `template/`). Versions follow `RELEASING.md`: tags are `kit-vMAJOR.MINOR.PATCH`, and the version in
`package.json` and `template/package.json` matches the tag.

## Unreleased

## 1.1.0 (proposed tag `kit-v1.1.0`)

Additive: no DataAppSpec or manifest change.

### Added
- `template/src/studio/fn.ts`, `bda.ts`, `fn.test.ts`: `bda.fn.call / run / watch / cancel / outputOf`, so a
  hand-built app can call the functions, agents and workflows its manifest declares under `functions`. The same
  files Studio serves over MCP `dataapp_sdk` and `GET /api/data-apps/sdk`.
- `template/README-FOR-AGENTS.md`: "Calling functions, agents and workflows" (declare pinned refs, local names
  only, a button's `onClick`, reuse on load, watch and Cancel, output as text, a person confirms a version that
  adds an import, runs as the viewer), the manifest fields a hand-built app uses, and the `bda.fn` errors.
- `docs/agents/`: the context collection for coding agents (Studio MCP, data apps, functions, agents, workflows,
  invocations, Detect and Explain, limits), generated from Studio's sources and stamped with their commits.
  Pending content review.
- `CLAUDE.md` and `template/CLAUDE.md`: route a coding agent to the Studio MCP's `studio_guide`, with a short
  protocol for working with non-engineers.
- `AGENTS.md`: a routing table at the top (compose, hand-build, functions/agents/workflows, changing the kit).
  States that composed (spec) apps cannot call functions, agents or workflows yet.
- `CHANGELOG.md`, `RELEASING.md`.
- `template/`: `npm run dev` can target preview (`BDA_API_ORIGIN`); `.env.example` describes both flows.

### Changed
- `scripts/no-real-ids.sh` now covers `template/` and `examples/`: `KIT_FORBIDDEN_IDS` no longer skips
  `template/`, fixture `model` ids there must start with `m_`, and SQL there must read `FROM` an `m_` model or a
  `<placeholder>`.
- `template/README-FOR-AGENTS.md` examples use the synthetic `m_retail_demo` model and its fields.
- Golden rules gain "no forms: start actions from a button's `onClick`" and "never build chat UI".

### Fixed
- `AGENTS.md` named `spec/dataapp-spec.v1.schema.json`; the contract is `spec/dataapp-spec.v2.schema.json`.
- `README.md` and `AGENTS.md` said "two ways to build" twice; `AGENTS.md` told every app builder to use only the
  `design_*` tools, which contradicted hand-building apps that call functions.
- `AGENTS.md`: the last two steps of "Adding a recipe" sat under "Adding a family".

## 1.0.0 (untagged)

The kit as merged up to `ccc87ac` (#1 to #7): DataAppSpec v2 with the core recipes and the `ab_test` family,
declared datasets and the composer, the `ask-show-ship` and `semantic-query` skills, declared persistence (store
broker), FilterBar and filters, panel context and the telemetry reporter, provenance, summary and `kit diff`,
deep links, readiness and Schedule Mode, and the hand-build `template/` with `<Panel>`.
