/**
 * A spec's manifest: the declared datasets, rendered, plus the limits the
 * hosting service enforces.
 *
 * There is no SQL in this file. Which queries exist and what they select is
 * declared in `recipes/datasets.json` and `families/<kind>/datasets.json`;
 * `datasets.mjs` renders them. Changing a query is a change to JSON in this
 * repository, and reaches the service through a kit release — never through a
 * code change on the service side.
 */

import { datasetsFor } from './catalogue.mjs'
import { renderDatasets } from './datasets.mjs'

export function deriveManifest(spec) {
  const manifest = {
    appId: spec.appId ?? '',
    entry: 'app.js',
    styles: ['app.css'],
    title: spec.title,
    queries: renderDatasets(spec, datasetsFor(spec)),
  }
  // Persistence is declared like queries: only what the manifest names is served.
  if (spec.store?.cache !== undefined) {
    manifest.cache = { ttlSeconds: spec.store.cache.ttl_seconds ?? 86400, maxValueBytes: spec.store.cache.max_value_bytes ?? 65536, writableBy: spec.store.cache.writable_by ?? 'viewer' }
  }
  if ((spec.store?.blobs ?? []).length > 0) {
    manifest.blobs = spec.store.blobs.map((blob) => ({ name: blob.name, kind: blob.kind ?? 'json', maxBytes: blob.max_bytes ?? 10485760, purpose: blob.purpose }))
  }
  // The runtime always reports panel context (invariant 9: it never renders chat
  // itself); this just tells the host whether *it* may offer a chat for this app.
  if (spec.chat !== undefined) {
    manifest.chat = { enabled: spec.chat.enabled, anchors: spec.chat.anchors ?? ['panel'] }
  }

  // Same declare-or-refuse bargain, and the same split the host enforces: `enabled` turns
  // reporting on, `values` decides whether the numbers a panel is showing may travel with it.
  if (spec.telemetry !== undefined) {
    manifest.telemetry = { enabled: spec.telemetry.enabled, values: spec.telemetry.values ?? false }
  }

  // Analyses travel verbatim: the service owns their config's grammar (closed world, checked on upload)
  // and runs them as the viewer. The kit only says which exist.
  if ((spec.analyses ?? []).length > 0) {
    manifest.analyses = spec.analyses.map((analysis) => ({
      id: analysis.id,
      kind: analysis.kind,
      ...(analysis.title === undefined ? {} : { title: analysis.title }),
      config: analysis.config,
      ...(analysis.bind === undefined ? {} : { bind: analysis.bind }),
      ...(analysis.calendar === undefined ? {} : { calendar: analysis.calendar }),
      ...(analysis.scope === undefined ? {} : { scope: analysis.scope }),
    }))
  }
  // Agent grants travel verbatim too: the service checks them closed-world on upload (a known connector, its
  // read-only tools) and forwards a grant only to the agent it names. No entry: no connector for that agent.
  if ((spec.agents ?? []).length > 0) {
    manifest.agents = spec.agents.map((agent) => ({
      id: agent.id,
      ...(agent.title === undefined ? {} : { title: agent.title }),
      ...(agent.connectors === undefined ? {} : {
        connectors: agent.connectors.map((c) => ({ slug: c.slug, tools: [...c.tools], access: c.access ?? 'read' })),
      }),
      ...(agent.input === undefined ? {} : { input: agent.input }),
    }))
  }
  return manifest
}

/** Tool names that write; refused locally with the reason the service gives on upload. */
const WRITE_TOOL = /^(create|edit|update|add|transition|delete|remove|assign|comment)/i

/**
 * The service's own contract, checked here so a failure is local and readable.
 * The service enforces these again on upload; this copy is a courtesy, not the
 * authority.
 */
export function checkManifest(manifest) {
  const errors = []
  if (manifest.queries.length > 32) errors.push(`${manifest.queries.length} queries; the limit is 32`)
  const blobNames = (manifest.blobs ?? []).map((blob) => blob.name)
  if (new Set(blobNames).size !== blobNames.length) errors.push('blob names must be unique')
  if (blobNames.length > 16) errors.push(`${blobNames.length} blobs; the limit is 16`)
  const analysisIds = (manifest.analyses ?? []).map((analysis) => analysis.id)
  if (new Set(analysisIds).size !== analysisIds.length) errors.push('analysis ids must be unique')
  if (analysisIds.length > 16) errors.push(`${analysisIds.length} analyses; the limit is 16`)
  const agentIds = (manifest.agents ?? []).map((agent) => agent.id)
  if (new Set(agentIds).size !== agentIds.length) errors.push('agent ids must be unique')
  if (agentIds.length > 8) errors.push(`${agentIds.length} agents; the limit is 8`)
  for (const agent of manifest.agents ?? []) {
    const slugs = (agent.connectors ?? []).map((c) => c.slug)
    if (new Set(slugs).size !== slugs.length) errors.push(`agent "${agent.id}" grants a connector twice`)
    for (const grant of agent.connectors ?? []) {
      if (grant.access !== 'read') errors.push(`agent "${agent.id}": ${grant.slug} access must be "read"`)
      for (const tool of grant.tools) {
        if (WRITE_TOOL.test(tool) || !/^(search|get|list|read|find)/i.test(tool)) {
          errors.push(`agent "${agent.id}": "${tool}" writes to ${grant.slug}; an agent is only ever granted read-only tools`)
        }
      }
    }
    if (agent.input && Object.hasOwn(agent.input, 'app')) errors.push(`agent "${agent.id}": input.app is set by Studio`)
  }
  const ids = new Set()
  for (const query of manifest.queries) {
    if (ids.has(query.id)) errors.push(`duplicate query id "${query.id}"`)
    ids.add(query.id)
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(query.id)) errors.push(`query id "${query.id}" is invalid`)
    if (query.sql.length > 8000) errors.push(`query "${query.id}" SQL is longer than 8000 characters`)
    if (query.sql.includes(';')) errors.push(`query "${query.id}" contains a semicolon`)
    if (query.parameters.length > 16) errors.push(`query "${query.id}" declares more than 16 parameters`)
    if (query.columns.length < 1 || query.columns.length > 64) errors.push(`query "${query.id}" must declare 1-64 columns`)
    const declared = new Set(query.parameters.map((parameter) => parameter.name))
    for (const match of query.sql.matchAll(/:([a-zA-Z_]\w*)/g)) if (!declared.has(match[1])) errors.push(`query "${query.id}" uses :${match[1]} without declaring it`)
  }
  return errors
}
