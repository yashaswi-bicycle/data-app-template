// @vitest-environment node
/**
 * Connector permissions in the app spec: `agents[]` grants an agent read access to a tenant connector (and fixes
 * part of its input). The composer validates the outline, refuses write tools locally with the service's reason,
 * and carries the grant into the manifest verbatim; the service checks it again, closed-world, on upload.
 */

import { describe, expect, it } from 'vitest'
import { checkManifest, deriveManifest } from '../compose/manifest.mjs'
import { resolveSpec } from '../compose/resolve.mjs'
import { validateSpec } from '../compose/validate.mjs'

describe('composer: agents[]', () => {
  const base = {
    version: 2,
    model: 'm_retail_demo',
    title: 'Failed orders and tickets',
    persona: 'pm',
    template: 'report',
    time: { from: '2026-08-01', to: 'tomorrow' },
    measures: [{ id: 'orders', column: 'orders_total', label: 'Orders', role: 'primary' }],
    dimensions: [{ field: 'region', label: 'Region' }],
    questions: [{ say: 'Totals?', recipe: 'kpis' }],
  }
  const tickets = {
    id: 'ticket_coverage',
    title: 'Jira coverage of failed orders',
    connectors: [{ slug: 'atlassian', tools: ['searchJiraIssuesUsingJql'], access: 'read' }],
    input: { match: { text: 'text' }, project: 'API' },
  }

  it('carries the grant into the manifest verbatim', () => {
    const spec = { ...base, agents: [tickets] }
    expect(validateSpec(spec).errors).toEqual([])
    const manifest = deriveManifest(resolveSpec(spec))
    expect(manifest.agents).toEqual([tickets])
    expect(checkManifest(manifest)).toEqual([])
  })

  it('defaults access to read', () => {
    const spec = { ...base, agents: [{ id: 'ticket_coverage', connectors: [{ slug: 'atlassian', tools: ['getJiraIssue'] }] }] }
    expect(deriveManifest(resolveSpec(spec)).agents[0].connectors[0].access).toBe('read')
  })

  it('refuses write tools, write access, unknown connectors and a pinned app', () => {
    const grant = (over: object) => ({ ...base, agents: [{ id: 'ticket_coverage', connectors: [{ slug: 'atlassian', tools: ['searchJiraIssuesUsingJql'], ...over }] }] })
    expect(validateSpec(grant({ tools: ['createJiraIssue'] })).ok).toBe(false)
    expect(validateSpec(grant({ access: 'write' })).ok).toBe(false)
    expect(validateSpec(grant({ slug: 'salesforce' })).ok).toBe(false)
    expect(validateSpec({ ...base, agents: [{ id: 'ticket_coverage', input: { app: {} } }] }).ok).toBe(false)
    const manifest = { entry: 'app.js', queries: [], agents: [{ id: 'x', connectors: [{ slug: 'atlassian', tools: ['addCommentToJiraIssue'], access: 'read' }] }] }
    expect(checkManifest(manifest).join('\n')).toMatch(/only ever granted read-only tools/)
  })

  it('leaves the manifest alone when nothing is declared', () => {
    expect(deriveManifest(resolveSpec(base))).not.toHaveProperty('agents')
  })
})
