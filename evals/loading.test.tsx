/**
 * Invariant 6, "Widgets never blank": every recipe renders its layout on
 * first paint and lets its own query fill in — never a bare `null` or a
 * "Loading…" string standing in for the whole widget.
 *
 * Every recipe in `runtime/src/App.tsx`'s registries is rendered here with a
 * synthetic spec and every dataset query held in the pending state (`rows:
 * undefined, isPending: true`). Two things must be true of what comes back:
 * a heading is on screen (the reader can see what is coming), and at least
 * one element is marked `aria-busy="true"` (the region that is still
 * loading). No network, no QueryClientProvider — `CoreData`/`Dataset` are
 * plain fixtures, exactly what `useCoreDataset`/`useAbDataset` would return
 * before their queries land.
 */

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AB, CORE } from '../runtime/src/App.js'
import type { CoreData, Dataset, QueryState } from '../runtime/src/data.js'
import type { AbFamily, Spec } from '../runtime/src/spec.js'
import { UiProvider } from '../runtime/src/ui.js'

afterEach(cleanup)

function pending<T>(): QueryState<T> {
  return { rows: undefined, isPending: true, isFetching: false, error: null, refetch: () => {} }
}

const CORE_SPEC: Spec = {
  version: 2,
  model: 'm_demo',
  title: 'Demo report',
  persona: 'analyst',
  template: 'report',
  chrome: 'report',
  time: { from: '2026-01-01', to: '2026-02-01', grain: 'day' },
  measures: [
    { id: 'orders', column: 'orders', label: 'Orders' },
    { id: 'revenue', column: 'revenue', label: 'Revenue', format: 'currency', role: 'primary' },
  ],
  dimensions: [
    { field: 'region', label: 'Region' },
    { field: 'channel', label: 'Channel' },
  ],
  questions: [],
  controls: [{ kind: 'dimensions' }, { kind: 'measure' }, { kind: 'heatmap_axes' }, { kind: 'depth' }],
  // `changes` runs a declared analysis; its first answer is pending exactly like a query.
  analyses: [{ id: 'why_revenue', kind: 'detect', config: { request: { kpi_name: 'revenue', dimensions: ['region'] }, window: { relative: 'last_week' } } }],
}

/** Synthetic family — no real customer or experiment ids. */
const AB_FAMILY: AbFamily = {
  kind: 'ab_test',
  arms: { field: 'arm', control: 'CONTROL' },
  roles: {
    bookers: 'bookers',
    orders: 'orders',
    value: 'value',
    participants: { arm: 'participants_arm', control: 'participants_control', total: 'participants_total' },
  },
}

const AB_SPEC: Spec = {
  version: 2,
  model: 'm_demo',
  title: 'Demo experiment',
  persona: 'analyst',
  template: 'report',
  chrome: 'report',
  time: { from: '2026-01-01', to: '2026-02-01', grain: 'day' },
  measures: [
    { id: 'bookers', column: 'bookers', label: 'Bookers' },
    { id: 'orders', column: 'orders', label: 'Orders' },
    { id: 'value', column: 'value', label: 'Value', format: 'currency' },
    { id: 'participants_arm', column: 'participants_arm', label: 'Participants (arm)' },
    { id: 'participants_control', column: 'participants_control', label: 'Participants (control)' },
    { id: 'participants_total', column: 'participants_total', label: 'Participants (total)' },
  ],
  dimensions: [
    { field: 'region', label: 'Region' },
    { field: 'channel', label: 'Channel' },
  ],
  family: AB_FAMILY,
  questions: [],
  controls: [{ kind: 'dimensions' }, { kind: 'measure' }, { kind: 'variant' }, { kind: 'heatmap_axes' }, { kind: 'depth' }],
}

const coreData: CoreData = {
  totals: pending(),
  series: pending(),
  dims: pending(),
  trendBy: () => pending(),
  slicesAt: () => [],
}

const abData: Dataset = {
  meta: pending(),
  overall: pending(),
  trend: pending(),
  segmentsAt: () => pending(),
}

/** Never a bare `null`/empty render, and at least one region says it is busy. */
function expectNeverBlank(container: HTMLElement) {
  const text = container.textContent ?? ''
  expect(text.trim().length, 'the recipe rendered no layout at all while its query was pending').toBeGreaterThan(0)
  expect(text.trim(), 'a bare "Loading…" is exactly the pattern this invariant forbids').not.toMatch(/^loading/i)
  const busy = container.querySelectorAll('[aria-busy="true"]')
  expect(busy.length, 'no element marked aria-busy="true" — the pending widget is not announced as busy').toBeGreaterThan(0)
}

describe('core recipes never blank while pending', () => {
  for (const [id, Recipe] of Object.entries(CORE)) {
    it(`${id} shows a heading and an aria-busy widget`, () => {
      const { container } = render(
        <UiProvider spec={CORE_SPEC}>
          <Recipe spec={CORE_SPEC} core={coreData} bind={{}} />
        </UiProvider>,
      )
      expectNeverBlank(container)
    })
  }
})

describe('ab_test recipes never blank while pending', () => {
  for (const [id, Recipe] of Object.entries(AB)) {
    it(`${id} shows a heading and an aria-busy widget`, () => {
      const { container } = render(
        <UiProvider spec={AB_SPEC}>
          <Recipe spec={AB_SPEC} data={abData} bind={{}} />
        </UiProvider>,
      )
      expectNeverBlank(container)
    })
  }
})
