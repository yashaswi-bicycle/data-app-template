/**
 * Schema + semantic validation of a DataAppSpec v2.
 *
 * Schema errors come from `spec/`. Semantic errors are what a schema cannot
 * say: that a recipe exists for this spec's family, that a bound measure or
 * dimension was declared, that a family's required roles resolve.
 *
 * Nothing here names a family, a metric or a recipe. What a family requires,
 * which metric names it adds, and how often a repeating dataset may appear
 * are all read from the catalogue — so a new family is a folder of JSON, not
 * an edit to this file.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { datasetsFor, loadCatalogue, recipesFor, templateFor } from './catalogue.mjs'
import { filtersOf } from './datasets.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const SCHEMA = JSON.parse(readFileSync(`${here}/../spec/dataapp-spec.v2.schema.json`, 'utf8'))

/** The service's cap on a query's declared parameters (`data_apps/manifest.py`). */
const PARAMETER_LIMIT = 16

let compiled
function validator() {
  if (compiled === undefined) {
    const ajv = new Ajv2020({ allErrors: true, strict: false, useDefaults: false })
    addFormats(ajv)
    compiled = ajv.compile(SCHEMA)
  }
  return compiled
}

const familyOf = (spec) => (spec.family === undefined ? undefined : loadCatalogue().families[spec.family.kind])

/** Control kinds that only exist because some family provides them. */
function claimedControls() {
  return new Set(Object.values(loadCatalogue().families).flatMap((family) => family.control_kinds ?? []))
}

/** Walk a dotted path through a family's roles. */
const roleAt = (roles, path) => path.split('.').reduce((node, key) => node?.[key], roles)

/** @returns {{ ok: boolean, errors: string[] }} */
export function validateSpec(spec) {
  const errors = []
  const check = validator()
  if (!check(spec)) {
    for (const error of check.errors ?? []) errors.push(`${error.instancePath || '/'} ${error.message}`)
    return { ok: false, errors }
  }

  if (templateFor(spec) === undefined) errors.push(`template "${spec.template}" is not in templates/`)
  const recipes = recipesFor(spec)
  const measureIds = new Set(spec.measures.map((measure) => measure.id))
  const dims = new Set(spec.dimensions.map((dimension) => dimension.field))
  const family = familyOf(spec)

  // Metric names a family adds. `measure` may be selected one at a time; `series` may also be charted alongside.
  const asMeasure = new Set(family?.metrics?.measure ?? [])
  const asSeries = new Set(family?.metrics?.series ?? family?.metrics?.measure ?? [])
  const okMeasure = (value) => asMeasure.has(value) || measureIds.has(value)
  const okSeries = (value) => asSeries.has(value) || measureIds.has(value)

  if (measureIds.size !== spec.measures.length) errors.push('/measures ids must be unique')
  if (spec.measures.filter((measure) => measure.role === 'primary').length > 1) errors.push('/measures at most one measure may be primary')

  if (spec.family !== undefined) {
    if (family === undefined) {
      errors.push(`/family kind "${spec.family.kind}" is not in families/`)
    } else {
      if (family.requires?.entity === true && spec.entity === undefined) errors.push(`/entity is required by the ${spec.family.kind} family`)
      if (family.requires?.arms === true && spec.family.arms?.field === undefined) errors.push(`/family/arms is required by the ${spec.family.kind} family`)
      for (const path of family.requires?.roles ?? []) {
        const id = roleAt(spec.family.roles, path)
        if (typeof id !== 'string' || !measureIds.has(id)) errors.push(`/family/roles/${path} is not a declared measure id`)
      }
    }
  }

  // A dataset that repeats costs one query per distinct bound value, so the declaration caps it.
  const repeats = datasetsFor(spec)
    .filter((dataset) => dataset.repeat !== undefined)
    .map((dataset) => ({ ...dataset.repeat, seen: new Set() }))

  const analysisIds = (spec.analyses ?? []).map((analysis) => analysis.id)
  if (new Set(analysisIds).size !== analysisIds.length) errors.push('/analyses ids must be unique')
  spec.analyses?.forEach((analysis, index) => {
    // The service refuses a baseline on a DETECT config; saying so here keeps the failure local.
    if (analysis.kind === 'detect' && analysis.config.baseline_window !== undefined) errors.push(`/analyses/${index}/config/baseline_window only applies to kind "explain"`)
  })

  spec.questions.forEach((question, index) => {
    const recipe = recipes[question.recipe]
    if (recipe === undefined) {
      errors.push(`/questions/${index} recipe "${question.recipe}" is not available for ${spec.family?.kind ?? 'core'} (have: ${Object.keys(recipes).join(', ')})`)
      return
    }
    // A recipe with an `analysis` binding runs a declared analysis, so the spec must declare one.
    const analysisSlot = Object.entries(recipe.bind ?? {}).find(([, slot]) => slot.type === 'analysis')
    if (analysisSlot !== undefined && analysisIds.length === 0) errors.push(`/questions/${index} recipe "${question.recipe}" runs an analysis, but the spec declares none in /analyses`)
    for (const [key, value] of Object.entries(question.bind ?? {})) {
      const slot = recipe.bind?.[key]
      if (slot === undefined) {
        errors.push(`/questions/${index}/bind/${key} is not a binding of recipe "${question.recipe}" (allowed: ${Object.keys(recipe.bind ?? {}).join(', ') || 'none'})`)
        continue
      }
      if (slot.type === 'measure' && value !== 'ui' && value !== 'primary' && !okMeasure(value)) errors.push(`/questions/${index}/bind/${key} "${value}" is not a declared measure`)
      if (slot.type === 'measures' && value !== 'ui' && value !== 'all' && value !== 'primary' && (!Array.isArray(value) || value.some((measure) => !okSeries(measure)))) {
        errors.push(`/questions/${index}/bind/${key} must be "all", "primary" or an array of declared measures`)
      }
      if (slot.type === 'analysis' && value !== 'first' && !analysisIds.includes(value)) errors.push(`/questions/${index}/bind/${key} "${value}" is not a declared analysis id`)
      if (slot.type === 'dim' && value !== 'ui' && value !== null && !dims.has(value)) errors.push(`/questions/${index}/bind/${key} "${value}" is not a declared dimension`)
      if (slot.type === 'dims' && value !== 'ui' && value !== 'all' && value !== 'first' && (!Array.isArray(value) || value.some((dimension) => !dims.has(dimension)))) {
        errors.push(`/questions/${index}/bind/${key} contains an undeclared dimension`)
      }
      for (const repeat of repeats) if (question.recipe === repeat.recipe && key === repeat.bind && typeof value === 'string') repeat.seen.add(value)
    }
  })
  for (const repeat of repeats) {
    const max = repeat.max ?? 3
    if (repeat.seen.size > max) errors.push(`at most ${max} "${repeat.recipe}" questions may bind a different ${repeat.bind} — each one costs a query`)
  }

  // `filter` and `time` are core kinds — every spec may use them, so they are never claimed by a family.
  const claimed = claimedControls()
  const provided = new Set(family?.control_kinds ?? [])
  const narrowed = new Set()
  spec.controls?.forEach((control, index) => {
    if (control.kind === 'measure' && Array.isArray(control.options) && control.options.some((measure) => !okMeasure(measure))) errors.push('/controls measure options must be declared measures')
    if (claimed.has(control.kind) && !provided.has(control.kind)) errors.push(`/controls "${control.kind}" needs a family that provides it`)
    if (control.kind !== 'filter') return
    if (!dims.has(control.dim)) errors.push(`/controls/${index}/dim "${control.dim}" is not a declared dimension`)
    if (narrowed.has(control.dim)) errors.push(`/controls/${index}/dim "${control.dim}" is narrowed by more than one filter`)
    narrowed.add(control.dim)
    // `options` is the chip list; the default is what the slots are seeded with, so it has to be pickable.
    const options = control.options
    const chosen = control.default === undefined ? [] : [control.default].flat()
    if (Array.isArray(options) && chosen.some((value) => !options.includes(value))) errors.push(`/controls/${index}/default is not among that filter's options`)
    if (control.multi !== true && Array.isArray(control.default)) errors.push(`/controls/${index}/default is a list, but the filter is not multi`)
    if (control.multi !== true && control.slots !== undefined) errors.push(`/controls/${index}/slots only applies to a multi filter`)
    if (chosen.length > (control.slots ?? Infinity)) errors.push(`/controls/${index}/default names ${chosen.length} values but the filter has ${control.slots} slots`)
  })

  // Each filter slot is a query parameter, and a query may declare at most 16.
  // Fail here with the arithmetic rather than let the service reject the upload.
  if (errors.length === 0) {
    const filters = filtersOf(spec)
    const slots = filters.reduce((total, filter) => total + filter.parameters.length, 0)
    const names = filters.flatMap((filter) => filter.parameters.map((parameter) => parameter.name))
    for (const name of new Set(names)) {
      if (names.filter((other) => other === name).length > 1) errors.push(`/controls two filters both render the parameter "${name}" — their dimension names differ only in punctuation`)
    }
    for (const dataset of datasetsFor(spec)) {
      if (dataset.filters !== true) continue
      const fixed = dataset.params === 'entity' && spec.entity !== undefined ? 3 : 2 // entity? + from + to
      const total = fixed + slots
      if (total > PARAMETER_LIMIT) errors.push(`filters on ${dataset.id} need ${total} parameters; the limit is ${PARAMETER_LIMIT} — lower \`slots\` or drop a filter`)
    }
  }

  const blobNames = new Set((spec.store?.blobs ?? []).map((blob) => blob.name))
  if (blobNames.size !== (spec.store?.blobs ?? []).length) errors.push('/store/blobs names must be unique')
  const targetsBlob = spec.rules?.targets_blob
  if (targetsBlob !== undefined && !blobNames.has(targetsBlob)) errors.push(`/rules/targets_blob "${targetsBlob}" is not a declared blob in /store/blobs`)

  const columns = spec.measures.map((measure) => measure.column)
  if (new Set(columns).size !== columns.length) errors.push('/measures two measures bind the same column')
  for (const dimension of dims) if (columns.includes(dimension)) errors.push(`"${dimension}" is both a measure column and a dimension`)

  // "none" says the chat may anchor to nothing in particular — it is meaningless
  // alongside a real anchor, and the schema's `enum` cannot express that on its own.
  const anchors = spec.chat?.anchors
  if (anchors !== undefined && anchors.includes('none') && anchors.length > 1) errors.push('/chat/anchors "none" cannot be combined with other anchors')

  return { ok: errors.length === 0, errors }
}
