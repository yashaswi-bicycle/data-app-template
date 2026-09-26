import { afterEach, describe, expect, it, vi } from 'vitest'
import { bda } from './bda.js'

afterEach(() => vi.restoreAllMocks())

type Sent = { type: string; requestId: string; [k: string]: unknown }

/** Pretend to be framed: `host` answers each posted message with zero or more replies, like fnBridge.ts. */
function framed(host: (message: Sent) => Array<Record<string, unknown>>) {
  const sent: Sent[] = []
  const parent = {
    postMessage: (message: Sent) => {
      sent.push(message)
      for (const reply of host(message)) {
        queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', { data: { requestId: message.requestId, ...reply } })))
      }
    },
  }
  vi.spyOn(window, 'parent', 'get').mockReturnValue(parent as unknown as Window)
  return sent
}

const INV = 'inv_01J8Z3K6T9W2Q4R7M5N8P0XYZA'
const running = { invocation_id: INV, status: 'running' }
const events = (extra: Record<string, unknown>) => ({ type: 'studio:sandbox:fn-events', invocationId: INV, ok: true, events: [], agentEvents: [], items: [], nextAfter: 0, ...extra })

describe('bda.fn', () => {
  it('call submits the local name, streams progress, and resolves with the output', async () => {
    const sent = framed((m) =>
      m.type === 'studio:sandbox:fn-call'
        ? [{ type: 'studio:sandbox:fn-result', ok: true, invocation: running }]
        : [
            events({ events: [{ seq: 1 }], items: [{ key: 'i1', kind: 'status', title: 'Started' }], final: false }),
            events({ final: true, invocation: { ...running, status: 'succeeded', output: { summary: 'ok' } } }),
          ],
    )
    const seen: string[] = []
    await expect(bda.fn.call('check_tickets', { vendor: 'Galaxy Connect' }, { onEvent: (e) => seen.push(...e.items.map((i) => i.title)) })).resolves.toEqual({ summary: 'ok' })
    expect(sent[0]).toMatchObject({ type: 'studio:sandbox:fn-call', name: 'check_tickets', input: { vendor: 'Galaxy Connect' }, mode: 'submit' })
    expect(sent[1]).toMatchObject({ type: 'studio:sandbox:fn-watch', invocationId: INV, after: 0 })
    expect(seen).toEqual(['Started'])
  })

  it('call rejects in words: refused by the host, a failed run, a cancelled run', async () => {
    framed(() => [{ type: 'studio:sandbox:fn-result', ok: false, error: { code: 'fn_not_declared', message: 'This app does not declare it.', status: 0 } }])
    await expect(bda.fn.call('nope', {})).rejects.toMatchObject({ code: 'fn_not_declared', message: 'This app does not declare it.' })

    vi.restoreAllMocks()
    framed((m) =>
      m.type === 'studio:sandbox:fn-call'
        ? [{ type: 'studio:sandbox:fn-result', ok: true, invocation: running }]
        : [events({ final: true, invocation: { ...running, status: 'failed', error: { code: 'budget_exceeded', message: 'The agent ran out of budget.' } } })],
    )
    await expect(bda.fn.call('check_tickets', {})).rejects.toMatchObject({ code: 'budget_exceeded', message: 'The agent ran out of budget.' })

    expect(() => bda.fn.outputOf({ invocation_id: INV, status: 'cancelled' })).toThrow('The run was cancelled.')
  })

  it('wait: false resolves with the invocation; cancel names it', async () => {
    const sent = framed((m) => [{ type: 'studio:sandbox:fn-result', ok: true, invocation: m.type === 'studio:sandbox:fn-cancel' ? { ...running, status: 'cancelled' } : running }])
    await expect(bda.fn.call('check_tickets', {}, { wait: false })).resolves.toEqual(running)
    await expect(bda.fn.cancel(INV)).resolves.toMatchObject({ status: 'cancelled' })
    expect(sent.map((m) => m.type)).toEqual(['studio:sandbox:fn-call', 'studio:sandbox:fn-cancel'])
  })

  it('watch rejects when the host ends it with an error', async () => {
    framed(() => [events({ ok: false, final: true, error: { code: 'invocation_not_found', message: 'This app did not start that run.' } })])
    await expect(bda.fn.watch(INV).done).rejects.toMatchObject({ code: 'invocation_not_found' })
  })

  it('is unavailable outside the host', async () => {
    await expect(bda.fn.call('check_tickets', {})).rejects.toMatchObject({ code: 'fn_unavailable' })
  })

  it('passes reuse and refresh through to the host, and keeps what the answer says', async () => {
    const reused = { invocation_id: INV, status: 'succeeded', reused: true, created_at: '2026-09-26T08:05:00Z', output: { summary: 'ok' } }
    const sent = framed(() => [{ type: 'studio:sandbox:fn-result', ok: true, invocation: reused }])
    const inv = await bda.fn.run('check_tickets', { vendor: 'Galaxy Connect' }, { reuse: '6h' })
    expect(sent[0]).toMatchObject({ type: 'studio:sandbox:fn-call', name: 'check_tickets', mode: 'submit', reuse: '6h' })
    expect(sent[0]).not.toHaveProperty('refresh')
    expect(sent).toHaveLength(1) // a reused answer is terminal: nothing to watch
    expect(inv).toMatchObject({ reused: true, created_at: '2026-09-26T08:05:00Z' })
    await bda.fn.run('check_tickets', {}, { refresh: true })
    expect(sent[1]).toMatchObject({ refresh: true })
    expect(sent[1]).not.toHaveProperty('reuse')
    await bda.fn.call('check_tickets', {})
    expect(sent[2]).not.toHaveProperty('reuse')
  })
})
