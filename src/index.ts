/**
 * dsh-plugin-side-chat — Host face.
 *
 * A side chat is a hidden, read-only branch of one main Session:
 *
 * - It is seeded with the main Session up to now — the completed-turn prefix
 *   when idle, or everything so far with the open tail closed by forked
 *   closers while a turn is still running (the same seed `session.fork`
 *   builds) — so the model sees the conversation so far, but nothing it does
 *   is written back to the main Session.
 * - It is created through `ctx.agents.create` with `origin: 'subagent'` and
 *   `parentSession` set to the main Session, but WITHOUT a live
 *   `parentAgent` and without a `subagent/catalog` entry in the parent log:
 *   the left Session tree hides it, the main Session gets no catalog row and
 *   no completion notification, and the shipped prompt routes refuse it.
 * - It only talks to the browser through this plugin's Connection Fetch
 *   routes (create / prompt / cancel / close / list).
 * - It is read-only by construction: its tools are restricted to a
 *   read-only allow-list, a per-agent guard denies everything else, and a
 *   global guard keyed on the side-chat id prefix backs that up for any
 *   resume path this plugin does not own. The permission preset is pinned to
 *   `read-only` as defence in depth.
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import {
  CANCEL_PATH, CLOSE_PATH, CREATE_PATH, isSideChatId, LIST_PATH, MAX_PROMPT_LENGTH, PROMPT_PATH,
  READ_ONLY_TOOLS, SIDE_CHAT_ID_PREFIX, SIDE_CHAT_PROVIDER,
  type SideChatAccepted, type SideChatCreated, type SideChatList, type SideChatSummary,
} from './shared.ts'
import { buildForkSeed } from './fork-seed.ts'

export type * from './shared.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'side-chat'

/** Hard dependencies; presets, default model and permission presets are optional. */
export const inject = ['connection', 'agents', 'sessionQuery', 'tools']

export interface Config {
  /** Agent preset mounted for side chats (falls back to the default preset when unknown). */
  agentPreset: string
  /** Descriptor label recorded in each side-chat log. */
  label: string
  /**
   * Hide non read-only tools from the side-chat model (default). When false
   * they stay visible, the read-only prompt section is left out, and every
   * call is refused by the guard instead. Only useful to exercise that guard.
   */
  hideUnavailableTools: boolean
}

export const Config: Schema<Config> = Schema.object({
  agentPreset: Schema.string().default('standard'),
  label: Schema.string().default('Side chat'),
  hideUnavailableTools: Schema.boolean().default(true),
})

const SESSION_ID = /^[A-Za-z0-9._:-]{1,200}$/
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,120}$/
const NO_STORE = { 'cache-control': 'no-store' } as const
const READ_ONLY = new Set(READ_ONLY_TOOLS)

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE })
}

function fail(status: number, error: string, code?: string): Response {
  return json(code === undefined ? { error } : { error, code }, status)
}

/** Read-only guard verdict shared by the per-agent and global guards. */
function denial(exec: Readonly<ToolExecution>): string | undefined {
  const id = exec.agent?.id
  if (id === undefined || !isSideChatId(id)) return undefined
  if (READ_ONLY.has(exec.name)) return undefined
  return `This is a read-only side chat: the tool "${exec.name}" is not available. `
    + `Only read-only tools (${READ_ONLY_TOOLS.join(', ')}) may be used; answer from the conversation `
    + 'and what you can read, and tell the user to make changes in the main conversation instead.'
}

/** The boundary `session.fork` uses on an idle log: the end of the latest completed turn. */
function latestCompletedPrefixBoundary(events: readonly SessionEvent[]): number | undefined {
  const lastTurnEnd = events.findLast(event => event.type === 'turn/end')
  if (lastTurnEnd === undefined) return undefined
  let boundary: number = lastTurnEnd.seq
  for (const next of events.slice(boundary + 1)) {
    if (next.type === 'turn/start'
      || (next.type === 'user/message' && (next as { surfaceOp?: unknown }).surfaceOp === 'append')
      || next.type === 'agent/inbox/spliced') break
    boundary = next.seq
  }
  return boundary
}

/**
 * Seed boundary: while a turn is still open (a `turn/start` with no later
 * `turn/end`) the cut is the log tail, and the forked closers in the seed
 * balance that open tail; otherwise the latest completed-turn prefix. A log
 * with no turn yields no seed.
 */
function seedBoundary(events: readonly SessionEvent[]): number | undefined {
  const lastTurnStart = events.findLastIndex(event => event.type === 'turn/start')
  const lastTurnEnd = events.findLastIndex(event => event.type === 'turn/end')
  if (lastTurnStart > lastTurnEnd) return events.at(-1)?.seq
  return latestCompletedPrefixBoundary(events)
}

function userMessage(text: string, requestId: string): UserMessage {
  const message = {
    id: globalThis.crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user', rpcId: requestId },
  }
  return Object.freeze(structuredClone(message)) as unknown as UserMessage
}

interface LiveSideChat {
  readonly handle: AgentHandle
  readonly parentSessionId: string
  readonly createdAt: number
}

interface AgentPresetsFace {
  resolve(id?: string): Promise<{ id: string; broken?: string }>
  mount(ctx: Context, id?: string): Promise<{ id: string }>
}

interface DefaultModelFace {
  currentSelection(): { provider: string; model: string }
}

interface PermissionPresetsFace {
  set(session: unknown, name: string): void
}

interface SessionListFace {
  listSessions(signal?: AbortSignal): Promise<{ header: { id: string; origin?: string; parentSession?: string; createdAt: number } }[]>
}

interface PromptFace {
  section(section: { name: string; order: number; text: string }): () => void
  getSectionOrder(name: 'PLAN_POLICY'): number
}

const READ_ONLY_POLICY = 'You are in a read-only side chat that branches off the main conversation above. '
  + 'Answer follow-up questions from that conversation and from what you can read. '
  + `Only these tools may be used: ${READ_ONLY_TOOLS.join(', ')}. `
  + 'Every other tool (file changes, shell commands, delegation, MCP tools) is refused, so do not call it; '
  + 'when the user asks for a change, explain what to do and suggest doing it in the main conversation.'

interface ScopedTools {
  presentAs(mode: 'native'): () => void
  restrict(filter: { allow?: readonly string[] }): () => void
  guard(guard: (exec: Readonly<ToolExecution>) => string | undefined): () => void
  schemas(scope?: object): { name: string }[]
}

/**
 * Plugin body.
 * @param ctx - Host plugin context.
 * @param config - resolved configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const live = new Map<string, LiveSideChat>()
  /** In-flight resumes, so two prompts cannot race two agents onto one log. */
  const resuming = new Map<string, Promise<Agent>>()
  const lifetime = new AbortController()

  ctx.effect(() => () => {
    lifetime.abort()
    live.clear()
  }, 'side-chat: lifetime')

  // Global backstop: whatever path brings a side-chat agent to life, its
  // tool calls stay read-only.
  ctx.tools.guard(denial)

  const presetId = async (): Promise<string | undefined> => {
    const presets = ctx.get('agentPresets') as AgentPresetsFace | undefined
    if (presets === undefined) return undefined
    try {
      return (await presets.resolve(config.agentPreset)).id
    } catch {
      return (await presets.resolve(undefined)).id
    }
  }

  const agentOptions = (): { provider: string; model: string } | undefined => {
    try {
      return (ctx.get('agentDefaultModel') as DefaultModelFace | undefined)?.currentSelection()
    } catch {
      return undefined
    }
  }

  /** Pre-publication composition shared by create and resume. */
  const setup = (preset: string | undefined, fresh: boolean) => async (agentCtx: Context, agent: Agent): Promise<void> => {
    const presets = ctx.get('agentPresets') as AgentPresetsFace | undefined
    if (presets !== undefined) await presets.mount(agentCtx, preset)
    const tools = agentCtx.tools as unknown as ScopedTools
    try {
      tools.presentAs('native')
    } catch (error) {
      ctx.logger.debug(`side-chat: presentAs(native) skipped: ${String(error)}`)
    }
    tools.guard(denial)
    // Tools a composition registers into this Agent's own scope (for example
    // the delegation tool) are exempt from `restrict()`; the guard refuses
    // them, and this section tells the model up front. Guard-test mode
    // leaves it out so the model actually attempts the refused calls.
    if (config.hideUnavailableTools) try {
      const prompt = agentCtx.get('systemPrompt') as PromptFace | undefined
      prompt?.section({ name: 'side-chat:read-only', order: prompt.getSectionOrder('PLAN_POLICY') + 10, text: READ_ONLY_POLICY })
    } catch (error) {
      ctx.logger.warn(`side-chat: read-only prompt section for ${agent.id} failed: ${String(error)}`)
    }
    if (config.hideUnavailableTools) {
      try {
        const allow = tools.schemas(agent).map(schema => schema.name).filter(toolName => READ_ONLY.has(toolName))
        tools.restrict({ allow })
      } catch (error) {
        // The guard above still denies every non read-only call.
        ctx.logger.warn(`side-chat: tool restriction for ${agent.id} failed: ${String(error)}`)
      }
    }
    if (fresh) {
      // Makes the Session addressable as a (one-shot, read-only) subagent
      // child of the main Session for history paging and following. The
      // parent log is never touched.
      const session = agent.session as unknown as { append(type: string, data: unknown): void }
      session.append('subagent/descriptor', {
        version: 3,
        mode: 'one-shot',
        provider: SIDE_CHAT_PROVIDER,
        label: config.label,
      })
    }
  }

  const pinReadOnly = (agent: Agent): void => {
    const permissions = ctx.get('permissionPresets') as PermissionPresetsFace | undefined
    if (permissions === undefined) return
    try {
      permissions.set(agent.session, 'read-only')
    } catch (error) {
      ctx.logger.warn(`side-chat: could not pin the read-only preset for ${agent.id}: ${String(error)}`)
    }
  }

  const track = (sessionId: string, parentSessionId: string, handle: AgentHandle): void => {
    live.set(sessionId, { handle, parentSessionId, createdAt: Date.now() })
    pinReadOnly(handle.agent)
  }

  const create = async (parentSessionId: string): Promise<SideChatCreated> => {
    const observation = await ctx.sessionQuery.observeSession(parentSessionId as SessionId)
    let seed: SessionEvent[] | undefined
    let inheritedEvents = 0
    let cwd: string | undefined
    try {
      if (observation.header.origin === 'subagent' || isSideChatId(observation.header.id)) {
        throw Object.assign(new Error('side chats can only branch from a main conversation'), { status: 400 })
      }
      cwd = observation.header.cwd
      const boundary = seedBoundary(observation.events)
      if (boundary !== undefined && observation.events[boundary]?.seq === boundary) {
        seed = buildForkSeed(observation.events, boundary)
        inheritedEvents = boundary + 1
      }
    } finally {
      (observation as Partial<Disposable>)[Symbol.dispose]?.()
    }
    const sessionId = `${SIDE_CHAT_ID_PREFIX}${globalThis.crypto.randomUUID()}` as SessionId
    const preset = await presetId()
    const options = agentOptions()
    const handle = await ctx.agents.create({
      sessionId,
      // `inheritedEventCount` is the copied prefix length only: the marker
      // and forked closers are child-owned synthetic events.
      ...(seed === undefined ? {} : { seed, inheritedEventCount: inheritedEvents as never }),
      meta: {
        ...(cwd === undefined ? {} : { cwd }),
        parentSession: parentSessionId as SessionId,
        origin: 'subagent',
        ...(seed === undefined ? {} : { isSeeded: true }),
        ...(preset === undefined ? {} : { agentPreset: preset }),
      },
      ...(options === undefined ? {} : { agentOptions: options }),
      signal: lifetime.signal,
      setup: setup(preset, true),
    })
    track(sessionId, parentSessionId, handle)
    return { sessionId, parentSessionId, inheritedEvents }
  }

  /** Live side-chat agent, resuming the persisted log under this plugin's composition. */
  const agentFor = async (sessionId: string, parentSessionId: string): Promise<Agent> => {
    const current = live.get(sessionId)
    if (current !== undefined && ctx.agents.get(sessionId as SessionId) === current.handle.agent) {
      if (current.parentSessionId !== parentSessionId) {
        throw Object.assign(new Error('side chat belongs to another conversation'), { status: 403 })
      }
      return current.handle.agent
    }
    // Validate each caller before sharing a live agent or an in-flight resume.
    const observation = await ctx.sessionQuery.observeSession(sessionId as SessionId)
    try {
      if (observation.header.origin !== 'subagent' || observation.header.parentSession !== parentSessionId) {
        throw Object.assign(new Error('not a side chat of this conversation'), { status: 403 })
      }
    } finally {
      (observation as Partial<Disposable>)[Symbol.dispose]?.()
    }
    const pending = resuming.get(sessionId)
    if (pending !== undefined) return pending
    const work = (async () => {
      const foreign = ctx.agents.get(sessionId as SessionId)
      if (foreign !== undefined) {
        // Some other owner resumed it; the global guard keeps it read-only.
        return foreign
      }
      const preset = await presetId()
      const options = agentOptions()
      const handle = await ctx.agents.resume({
        resumeSessionId: sessionId as SessionId,
        ...(options === undefined ? {} : { agentOptions: options }),
        signal: lifetime.signal,
        setup: setup(preset, false),
      })
      track(sessionId, parentSessionId, handle)
      return handle.agent
    })()
    resuming.set(sessionId, work)
    try {
      return await work
    } finally {
      resuming.delete(sessionId)
    }
  }

  const readBody = async (request: Request): Promise<Record<string, unknown> | undefined> => {
    try {
      const body = await request.json() as unknown
      return typeof body === 'object' && body !== null ? body as Record<string, unknown> : undefined
    } catch {
      return undefined
    }
  }

  const sessionField = (body: Record<string, unknown>, key: string): string | undefined => {
    const value = body[key]
    return typeof value === 'string' && SESSION_ID.test(value) ? value : undefined
  }

  const failure = (error: unknown): Response => {
    const status = (error as { status?: unknown }).status
    const code = (error as { code?: unknown }).code
    if (typeof status === 'number') return fail(status, (error as Error).message)
    if (code === 'SESSION_QUERY_SESSION_NOT_FOUND') return fail(404, 'session not found', code)
    ctx.logger.warn(`side-chat: request failed: ${String(error)}`)
    return fail(500, String(error))
  }

  ctx.connection.fetch.register({
    path: CREATE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const body = await readBody(request)
      const parentSessionId = body === undefined ? undefined : sessionField(body, 'parentSessionId')
      if (parentSessionId === undefined || isSideChatId(parentSessionId)) return fail(400, 'invalid parentSessionId')
      try {
        return json(await create(parentSessionId))
      } catch (error) {
        return failure(error)
      }
    },
  })

  ctx.connection.fetch.register({
    path: PROMPT_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const body = await readBody(request)
      if (body === undefined) return fail(400, 'invalid JSON body')
      const sessionId = sessionField(body, 'sessionId')
      const parentSessionId = sessionField(body, 'parentSessionId')
      const text = body['text']
      const requestId = typeof body['requestId'] === 'string' && REQUEST_ID.test(body['requestId'])
        ? body['requestId']
        : globalThis.crypto.randomUUID()
      if (sessionId === undefined || !isSideChatId(sessionId) || parentSessionId === undefined) {
        return fail(400, 'invalid sessionId or parentSessionId')
      }
      if (typeof text !== 'string' || text.trim() === '' || text.length > MAX_PROMPT_LENGTH) {
        return fail(400, 'invalid text')
      }
      try {
        const agent = await agentFor(sessionId, parentSessionId)
        agent.followup(userMessage(text, requestId))
        return json({ accepted: true } satisfies SideChatAccepted)
      } catch (error) {
        return failure(error)
      }
    },
  })

  ctx.connection.fetch.register({
    path: CANCEL_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const body = await readBody(request)
      const sessionId = body === undefined ? undefined : sessionField(body, 'sessionId')
      if (sessionId === undefined || !isSideChatId(sessionId)) return fail(400, 'invalid sessionId')
      const agent = ctx.agents.get(sessionId as SessionId)
      if (agent === undefined) return json({ accepted: false } satisfies SideChatAccepted)
      try {
        agent.cancel({ kind: 'user' } as never)
        return json({ accepted: true } satisfies SideChatAccepted)
      } catch (error) {
        return failure(error)
      }
    },
  })

  ctx.connection.fetch.register({
    path: CLOSE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const body = await readBody(request)
      const sessionId = body === undefined ? undefined : sessionField(body, 'sessionId')
      if (sessionId === undefined || !isSideChatId(sessionId)) return fail(400, 'invalid sessionId')
      const entry = live.get(sessionId)
      if (entry === undefined) return json({ accepted: false } satisfies SideChatAccepted)
      live.delete(sessionId)
      try {
        await entry.handle.dispose()
        return json({ accepted: true } satisfies SideChatAccepted)
      } catch (error) {
        return failure(error)
      }
    },
  })

  /**
   * Side chats of one main Session, newest first: the live ones plus those
   * persisted by an earlier Host run (they resume on their next prompt).
   */
  const listFor = async (parentSessionId: string, signal: AbortSignal): Promise<SideChatSummary[]> => {
    const found = new Map<string, SideChatSummary>()
    for (const [sessionId, entry] of live) {
      if (entry.parentSessionId !== parentSessionId) continue
      if (ctx.agents.get(sessionId as SessionId) !== entry.handle.agent) continue
      found.set(sessionId, { sessionId, parentSessionId, createdAt: entry.createdAt })
    }
    const query = ctx.sessionQuery as unknown as SessionListFace
    for (const record of await query.listSessions(signal)) {
      const header = record.header
      if (!isSideChatId(header.id) || header.origin !== 'subagent' || header.parentSession !== parentSessionId) continue
      if (!found.has(header.id)) found.set(header.id, { sessionId: header.id, parentSessionId, createdAt: header.createdAt })
    }
    return [...found.values()].sort((a, b) => b.createdAt - a.createdAt)
  }

  ctx.connection.fetch.register({
    path: LIST_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: (request) => {
      const parentSessionId = new URL(request.url).searchParams.get('parentSessionId')
      if (parentSessionId === null || !SESSION_ID.test(parentSessionId)) {
        return Promise.resolve(fail(400, 'invalid parentSessionId'))
      }
      return listFor(parentSessionId, request.signal).then(
        sessions => json({ sessions } satisfies SideChatList),
        (error: unknown) => fail(500, `listing side chats failed: ${String(error)}`),
      )
    },
  })
}
