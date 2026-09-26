/**
 * The app-code surface for host-brokered calls: `bda.fn.call(...)`, `bda.fn.watch(...)`, `bda.fn.cancel(...)`.
 * Served by Studio with `fn.ts` (`GET /api/data-apps/sdk`, MCP `dataapp_sdk`); both go in the app's `src/studio/`.
 */

import { fn } from './fn.js'

export const bda = { fn } as const
