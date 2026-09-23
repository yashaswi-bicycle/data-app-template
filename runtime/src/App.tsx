/**
 * Spec in, app out.
 *
 * The chrome owns the entity picker and page-wide controls; the panels the
 * composer resolved are rendered in order by their recipe. Core recipes read
 * the generic datasets; family recipes read the family's.
 */

import { type ComponentType, type ReactElement, useEffect, useState } from 'react'
import { Render as AbCumulativeTrend } from '../../families/ab_test/recipes/cumulative_trend/Render.js'
import { Render as AbExtremes } from '../../families/ab_test/recipes/extremes/Render.js'
import { Render as AbHeatmap } from '../../families/ab_test/recipes/heatmap/Render.js'
import { Render as AbHypothesis } from '../../families/ab_test/recipes/hypothesis/Render.js'
import { Render as AbInsights } from '../../families/ab_test/recipes/insights/Render.js'
import { Render as AbKpiTiles } from '../../families/ab_test/recipes/kpi_tiles/Render.js'
import { Render as AbLiftByDimension } from '../../families/ab_test/recipes/lift_by_dimension/Render.js'
import { Render as AbLiftersDraggers } from '../../families/ab_test/recipes/lifters_draggers/Render.js'
import { Render as AbOverview } from '../../families/ab_test/recipes/overview/Render.js'
import { Render as AbVerdict } from '../../families/ab_test/recipes/verdict/Render.js'
import { Render as AbVolumeVsLift } from '../../families/ab_test/recipes/volume_vs_lift/Render.js'
import { Render as Breakdown } from '../../recipes/breakdown/Render.js'
import { Render as Changes } from '../../recipes/changes/Render.js'
import { Render as Heatmap } from '../../recipes/heatmap/Render.js'
import { Render as Kpis } from '../../recipes/kpis/Render.js'
import { Render as Narrative } from '../../recipes/narrative/Render.js'
import { Render as Ranking } from '../../recipes/ranking/Render.js'
import { Render as Summary } from '../../recipes/summary/Render.js'
import { Render as Table } from '../../recipes/table/Render.js'
import { Render as Trend } from '../../recipes/trend/Render.js'
import { Render as Verdict } from '../../recipes/verdict/Render.js'
import { ExplorerChrome } from './chrome/Explorer.js'
import { ReportChrome } from './chrome/Report.js'
import { ControlsProvider } from './controls.js'
import { type CoreData, type Dataset, useAbDataset, useCoreDataset } from './data.js'
import type { CoreProps, RecipeProps } from './parts.js'
import { type AbFamily, isAb, type Panel, type Spec } from './spec.js'
import { PanelMetaProvider } from './studio/contextRegistry.js'
import { applySnapshotClass, renderState } from './studio/hostState.js'
import { UiProvider } from './ui.js'

/** Exported for evals/loading.test.tsx, which renders every recipe with its datasets pending. */
export const CORE: Record<string, ComponentType<CoreProps>> = {
  kpis: Kpis,
  verdict: Verdict,
  trend: Trend,
  breakdown: Breakdown,
  ranking: Ranking,
  heatmap: Heatmap,
  table: Table,
  narrative: Narrative,
  summary: Summary,
  changes: Changes,
}

/** Exported for evals/loading.test.tsx. */
export const AB: Record<string, ComponentType<RecipeProps>> = {
  verdict: AbVerdict,
  kpi_tiles: AbKpiTiles,
  hypothesis: AbHypothesis,
  insights: AbInsights,
  lift_by_dimension: AbLiftByDimension,
  lifters_draggers: AbLiftersDraggers,
  cumulative_trend: AbCumulativeTrend,
  volume_vs_lift: AbVolumeVsLift,
  heatmap: AbHeatmap,
  extremes: AbExtremes,
  overview: AbOverview,
}

export function App({ spec }: { spec: Spec }) {
  const [entityId, setEntityId] = useState<string | undefined>(undefined)
  // Capture mode (T9.0, contract 4): one class on the document root, and
  // `theme.css` does the rest. Nothing is rendered differently, so a capture
  // shows the same panels — and the same filters — a viewer would see.
  const snapshot = renderState().snapshot === true
  useEffect(() => applySnapshotClass(snapshot), [snapshot])
  const Chrome = (spec.chrome ?? (spec.template === 'explorer' ? 'explorer' : 'report')) === 'explorer' ? ExplorerChrome : ReportChrome
  const needsEntity = spec.entity !== undefined
  return (
    <UiProvider spec={spec}>
      <ControlsProvider spec={spec}>
        <Chrome spec={spec} entityId={entityId} onEntity={setEntityId}>
          {needsEntity && entityId === undefined ? null : isAb(spec) ? <AbBody spec={spec} entityId={entityId ?? ''} /> : <CoreBody spec={spec} entityId={entityId} />}
        </Chrome>
      </ControlsProvider>
    </UiProvider>
  )
}

/**
 * Panels render immediately, unconditionally: each one is handed the
 * dataset and reads its own `QueryState`s to decide, per widget, whether to
 * show a skeleton, an error with Retry, or its rows. Never gate this on
 * `core`/`data` being "ready" as a whole — see AGENTS.md's "Widgets never
 * blank" invariant.
 */
function CoreBody({ spec, entityId }: { spec: Spec; entityId: string | undefined }) {
  const core = useCoreDataset(spec, entityId)
  return <Panels panels={panelsOf(spec)} render={(panel, index) => <CorePanel key={index} spec={spec} core={core} panel={panel} index={index} />} />
}

function AbBody({ spec, entityId }: { spec: Spec & { family: AbFamily }; entityId: string }) {
  const data = useAbDataset(spec, entityId)
  return <Panels panels={panelsOf(spec)} render={(panel, index) => <AbPanel key={index} spec={spec} data={data} panel={panel} index={index} />} />
}

function panelsOf(spec: Spec): readonly Panel[] {
  return spec.panels ?? spec.questions.map((question) => ({ recipe: question.recipe, bind: question.bind ?? {}, say: question.say }))
}

/** `p3:ranking` — the resolved panel's position plus its recipe. Stable across a render, which is what the context reporter keys its registry on. */
function panelId(index: number, recipe: string): string {
  return `p${index}:${recipe}`
}

function CorePanel({ spec, core, panel, index }: { spec: Spec; core: CoreData; panel: Panel; index: number }) {
  const Recipe = CORE[panel.recipe]
  if (Recipe === undefined) return <div className="bda-state">Unknown recipe “{panel.recipe}”.</div>
  const meta = { panelId: panelId(index, panel.recipe), recipe: panel.recipe, say: panel.say, bind: panel.bind ?? {}, ...(panel.explain === undefined ? {} : { explain: panel.explain }) }
  return (
    <PanelMetaProvider value={meta}>
      <Recipe spec={spec} core={core} bind={panel.bind ?? {}} />
    </PanelMetaProvider>
  )
}

function AbPanel({ spec, data, panel, index }: { spec: Spec; data: Dataset; panel: Panel; index: number }) {
  const Recipe = AB[panel.recipe]
  if (Recipe === undefined) return <div className="bda-state">Unknown recipe “{panel.recipe}”.</div>
  const meta = { panelId: panelId(index, panel.recipe), recipe: panel.recipe, say: panel.say, bind: panel.bind ?? {}, ...(panel.explain === undefined ? {} : { explain: panel.explain }) }
  return (
    <PanelMetaProvider value={meta}>
      <Recipe spec={spec} data={data} bind={panel.bind ?? {}} />
    </PanelMetaProvider>
  )
}

/** Half-width neighbours share a row; everything else is full width. */
function Panels({ panels, render }: { panels: readonly Panel[]; render: (panel: Panel, index: number) => ReactElement }) {
  const groups: Panel[][] = []
  for (const panel of panels) {
    const last = groups[groups.length - 1]
    if (panel.width === 'half' && last !== undefined && last.length === 1 && last[0]?.width === 'half') last.push(panel)
    else groups.push([panel])
  }
  let index = 0
  return (
    <>
      {groups.map((group, groupIndex) => {
        if (group.length === 2) {
          return (
            <div key={groupIndex} className="kit-grid2">
              {group.map((panel) => render(panel, index++))}
            </div>
          )
        }
        const panel = group[0]
        return panel === undefined ? null : render(panel, index++)
      })}
    </>
  )
}
