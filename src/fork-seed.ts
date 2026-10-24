/**
 * Exact port of `buildForkSeed` from @deepseek-ai/dsh-session 0.2.1-rc.2
 * (`lib/types/fork.js` + `lib/types/repair.js`), inlined so the Host face
 * keeps zero runtime dsh imports. Only the `forked` closer cause is ported;
 * the `interrupted` texts are unused here.
 */
import type { SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'

/** Recovery code for an assistant tool request that never reached a recorded call start. */
const TOOL_NOT_STARTED = 'TOOL_NOT_STARTED'
/** Recovery code for a recorded tool call whose completed outcome was not durably recorded. */
const TOOL_OUTCOME_UNKNOWN = 'TOOL_OUTCOME_UNKNOWN'

/** Model-visible wording of the synthetic error tool results (core `CLOSER_TEXT.forked`, verbatim). */
const CLOSER_TEXT = {
  started: 'The history inherited by this branch records this tool call starting but does not include its result. The parent session may have completed it after the fork point. Decide whether to retry from the tool semantics: retry only if the operation is read-only or idempotent; if it may have side effects, first verify external state or ask the user. Do not retry blindly.',
  notStarted: 'The history inherited by this branch has no record of this tool call starting. The parent session may have executed it after the fork point. Decide whether to retry from the tool semantics: retry only if the operation is read-only or idempotent; if it may have side effects, first verify external state or ask the user. Do not retry blindly.',
} as const

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) deepFreeze(item)
    Object.freeze(value)
  }
  return value
}

interface PendingCall {
  turn: number
  step: number
  callSeq?: SessionSeq
}

/**
 * Core `ToolCallRecovery` restricted to the `forked` cause: pending
 * identities of assistant tool requests without a matching result. Closed
 * steps and turn boundaries discard pending requests.
 */
class ToolCallRecovery {
  private readonly pendingCalls = new Map<string, PendingCall>()
  private last: { seq: SessionSeq; time: number } | undefined

  observe(event: SessionEvent): void {
    this.last = { seq: event.seq, time: event.time }
    switch (event.type) {
      case 'turn/start':
      case 'turn/end':
      case 'step/end':
        this.pendingCalls.clear()
        break
      case 'assistant/message':
        for (const block of event.data.message.content) {
          if (block.type === 'tool-call') {
            this.pendingCalls.set(block.id, { turn: event.data.turn, step: event.data.step })
          }
        }
        break
      case 'tool/call': {
        const entry = this.pendingCalls.get(event.data.callId)
        if (entry) entry.callSeq = event.seq
        break
      }
      case 'tool/result': {
        const callId = event.data.message.source.callId
        const entry = this.pendingCalls.get(callId)
        if (event.surfaceOp === 'append' && entry !== undefined
          && entry.turn === event.data.turn && entry.step === event.data.step) {
          this.pendingCalls.delete(callId)
        }
        break
      }
      default:
        break
    }
  }

  results(): SessionEvent[] {
    if (this.last === undefined) return []
    let seq: number = this.last.seq + 1
    const time = this.last.time
    const results: SessionEvent[] = []
    for (const [callId, { turn, step, callSeq }] of this.pendingCalls) {
      const started = callSeq !== undefined
      const message = deepFreeze({
        id: `forked-tool-result-${callId}-${seq}`,
        role: 'tool',
        toolCallId: callId,
        isError: true,
        source: { kind: 'tool', callId },
        content: [{ type: 'text', text: started ? CLOSER_TEXT.started : CLOSER_TEXT.notStarted }],
      })
      results.push({
        type: 'tool/result',
        seq: seq++,
        time,
        data: {
          turn,
          step,
          message,
          error: started
            ? { name: 'ToolOutcomeUnknownError', code: TOOL_OUTCOME_UNKNOWN }
            : { name: 'ToolNotStartedError', code: TOOL_NOT_STARTED },
        },
        surfaceOp: 'append',
        ...(started ? { sourceEventSeqs: [callSeq] } : {}),
      } as unknown as SessionEvent)
    }
    return results
  }
}

/**
 * Core `openTurnClosers(events, { kind: 'forked' })`: unmatched calls receive
 * error results first, followed by an open `step/end` and a `forked`
 * `turn/end`; sequences continue the log and timestamps reuse the last real
 * event. A balanced or empty log returns no events.
 */
function openTurnClosers(events: readonly SessionEvent[]): SessionEvent[] {
  let openTurn: number | null = null
  let openStep: number | null = null
  const recovery = new ToolCallRecovery()
  for (const event of events) {
    recovery.observe(event)
    switch (event.type) {
      case 'turn/start':
        openTurn = event.data.turn
        openStep = null
        break
      case 'turn/end':
        openTurn = null
        openStep = null
        break
      case 'step/start':
        openStep = event.data.step
        break
      case 'step/end':
        openStep = null
        break
      default:
        break
    }
  }
  const last = events.at(-1)
  if (openTurn === null || last === undefined) return []
  const closers = recovery.results()
  let seq: number = last.seq + closers.length + 1
  const time = last.time
  if (openStep !== null) {
    closers.push({
      type: 'step/end',
      seq: seq++,
      time,
      data: { turn: openTurn, step: openStep },
    } as unknown as SessionEvent)
  }
  closers.push({
    type: 'turn/end',
    seq: seq++,
    time,
    data: { turn: openTurn, reason: { kind: 'forked' } },
  } as unknown as SessionEvent)
  return closers
}

/**
 * Core `buildForkSeed`: copy an inclusive event prefix, mark its inherited
 * cut, and close its open tail with forked results and step/turn endings.
 * Closed steps and turns are preserved unchanged.
 *
 * @param events - source log with contiguous seqs from zero.
 * @param boundary - inclusive source event seq the side chat inherits through.
 * @returns the source prefix objects, the marker, then synthetic closers; the
 *   inherited prefix counted by `inheritedEventCount` is `boundary + 1`.
 */
export function buildForkSeed(events: readonly SessionEvent[], boundary: number): SessionEvent[] {
  const last = events[boundary]
  if (last === undefined) throw new Error(`side-chat: boundary ${boundary} is outside the source log`)
  const prefix = events.slice(0, boundary + 1)
  prefix.push({
    type: 'session/end-seed',
    seq: boundary + 1,
    time: last.time,
    data: { inherited: true },
  } as unknown as SessionEvent)
  return prefix.concat(openTurnClosers(prefix))
}
