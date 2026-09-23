// @vitest-environment node
/**
 * The composer's half of declared analyses: `analyses[]` is validated
 * (outline only — the service owns the config grammar) and carried into the
 * manifest verbatim. The panel's half is `evals/analyses.test.tsx`.
 */

import { describe, expect, it } from 'vitest'
import { deriveManifest } from '../compose/manifest.mjs'
import { resolveSpec } from '../compose/resolve.mjs'
import { validateSpec } from '../compose/validate.mjs'

describe('composer: analyses[]', () => {
  const base = {
    version: 2,
    model: 'm_retail_demo',
    title: 'Retail — what changed',
    persona: 'pm',
    template: 'report',
    time: { from: '2026-08-01', to: 'tomorrow' },
    measures: [{ id: 'revenue', column: 'revenue_total', label: 'Revenue', role: 'primary' }],
    dimensions: [{ field: 'region', label: 'Region' }],
    questions: [{ say: 'What changed and why?', recipe: 'changes' }],
  }
  const analysis = { id: 'why_revenue', kind: 'explain', config: { request: { kpi_name: 'revenue_total', mode: 'EXPLAIN', dimensions: ['region'] }, window: { relative: 'last_week' } } }

  it('needs an analysis declared for a changes panel', () => {
    expect(validateSpec(base).errors.join('\n')).toMatch(/runs an analysis, but the spec declares none/)
  })

  it('refuses an undeclared id and duplicate ids', () => {
    const errors = validateSpec({ ...base, analyses: [analysis, analysis], questions: [{ say: 'Why?', recipe: 'changes', bind: { analysis: 'nope' } }] }).errors.join('\n')
    expect(errors).toMatch(/"nope" is not a declared analysis id/)
    expect(errors).toMatch(/analyses ids must be unique/)
  })

  it('refuses a baseline on a detect analysis and a malformed config', () => {
    expect(validateSpec({ ...base, analyses: [{ ...analysis, kind: 'detect', config: { ...analysis.config, baseline_window: { shift: 'P7D' } } }] }).errors.join('\n')).toMatch(/baseline_window only applies/)
    expect(validateSpec({ ...base, analyses: [{ ...analysis, config: { window: {} } }] }).ok).toBe(false)
  })

  it('carries analyses into the manifest verbatim', () => {
    const spec = { ...base, analyses: [{ ...analysis, title: 'What moved revenue', scope: 'shared', bind: { filters: false } }] }
    expect(validateSpec(spec).errors).toEqual([])
    const manifest = deriveManifest(resolveSpec(spec))
    expect(manifest.analyses).toEqual([{ id: 'why_revenue', kind: 'explain', title: 'What moved revenue', config: analysis.config, bind: { filters: false }, scope: 'shared' }])
  })

  it('leaves the manifest alone when nothing is declared', () => {
    const { questions: _questions, ...rest } = base
    expect(deriveManifest(resolveSpec({ ...rest, questions: [{ say: 'Totals?', recipe: 'kpis' }] }))).not.toHaveProperty('analyses')
  })
})
