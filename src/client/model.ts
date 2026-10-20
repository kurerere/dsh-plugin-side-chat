/**
 * React-free state of the side chats this browser knows about, keyed by the
 * main Session they branch from. The current side chat per main Session is
 * remembered in localStorage so it survives reloads and Host restarts (its
 * history stays on disk; the Host resumes it on the next prompt).
 */

import {
  CANCEL_PATH, CLOSE_PATH, CREATE_PATH, isSideChatId, LIST_PATH, PROMPT_PATH,
  type SideChatCreated, type SideChatList,
} from '../shared.ts'

/** Document-relative route URL (the page may be served under a token prefix). */
const route = (path: string): string => path.slice(1)

const STORE_KEY = 'dsh-plugin-side-chat.current.v1'

export interface SideChatEntry {
  /** Current side chat of this main Session, if any. */
  childSessionId?: string
  /** Events inherited at creation (undefined when unknown, e.g. after a reload). */
  inheritedEvents?: number
  creating: boolean
  error?: string
}

export type SideChatState = Readonly<Record<string, SideChatEntry>>

function readStored(): Record<string, string> {
  try {
    const raw = globalThis.localStorage?.getItem(STORE_KEY)
    if (raw === null || raw === undefined) return {}
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return {}
    const result: Record<string, string> = {}
    for (const [parent, child] of Object.entries(parsed)) {
      if (typeof child === 'string' && isSideChatId(child)) result[parent] = child
    }
    return result
  } catch {
    return {}
  }
}

function writeStored(value: Record<string, string>): void {
  try {
    globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify(value))
  } catch {
    // Storage may be unavailable; the side chat still works for this page.
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await globalThis.fetch(route(path), {
    cache: 'no-store',
    ...init,
    ...(init?.body === undefined ? {} : { headers: { 'content-type': 'application/json' } }),
  })
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) {
    throw Object.assign(new Error(typeof body.error === 'string' ? body.error : `HTTP ${response.status}`), {
      status: response.status,
    })
  }
  return body
}

const post = <T>(path: string, body: unknown): Promise<T> =>
  call<T>(path, { method: 'POST', body: JSON.stringify(body) })

/** Shared side-chat state plus the Host calls that change it. */
export class SideChatModel {
  private state: SideChatState = {}
  private readonly listeners = new Set<() => void>()
  private readonly stored = readStored()
  private readonly reconciled = new Set<string>()

  /** Observable face bound by the slot renderer as `useSideChats(selector)`. */
  readonly store = {
    getSnapshot: (): SideChatState => this.state,
    subscribe: (listener: () => void): (() => void) => {
      this.listeners.add(listener)
      return () => { this.listeners.delete(listener) }
    },
  }

  private patch(parentSessionId: string, next: SideChatEntry): void {
    this.state = { ...this.state, [parentSessionId]: next }
    for (const listener of [...this.listeners]) listener()
  }

  private entry(parentSessionId: string): SideChatEntry {
    return this.state[parentSessionId] ?? { creating: false }
  }

  private remember(parentSessionId: string, childSessionId: string | undefined): void {
    if (childSessionId === undefined) delete this.stored[parentSessionId]
    else this.stored[parentSessionId] = childSessionId
    writeStored(this.stored)
  }

  /**
   * Make the remembered side chat of a main Session known, then prefer the
   * newest one the Host still has live (another tab may have created it).
   * @param parentSessionId - main Session id.
   */
  load(parentSessionId: string): void {
    if (this.state[parentSessionId] === undefined) {
      const child = this.stored[parentSessionId]
      this.patch(parentSessionId, { creating: false, ...(child === undefined ? {} : { childSessionId: child }) })
    }
    if (this.reconciled.has(parentSessionId)) return
    this.reconciled.add(parentSessionId)
    const query = new URLSearchParams({ parentSessionId })
    call<SideChatList>(`${LIST_PATH}?${query}`).then((list) => {
      const newest = list.sessions[0]
      const current = this.entry(parentSessionId)
      if (newest === undefined || current.childSessionId !== undefined || current.creating) return
      this.remember(parentSessionId, newest.sessionId)
      this.patch(parentSessionId, { ...current, childSessionId: newest.sessionId })
    }, () => {
      this.reconciled.delete(parentSessionId)
    })
  }

  /**
   * Create a new side chat for a main Session, replacing the current one.
   * @param parentSessionId - main Session id.
   */
  async create(parentSessionId: string): Promise<void> {
    const current = this.entry(parentSessionId)
    if (current.creating) return
    this.patch(parentSessionId, { creating: true })
    const previous = current.childSessionId
    try {
      const created = await post<SideChatCreated>(CREATE_PATH, { parentSessionId })
      this.remember(parentSessionId, created.sessionId)
      this.patch(parentSessionId, {
        creating: false,
        childSessionId: created.sessionId,
        inheritedEvents: created.inheritedEvents,
      })
      // The replaced side chat's history stays on disk; only its live agent stops.
      if (previous !== undefined) void post(CLOSE_PATH, { sessionId: previous }).catch(() => {})
    } catch (error) {
      this.patch(parentSessionId, {
        creating: false,
        ...(previous === undefined ? {} : { childSessionId: previous }),
        error: (error as Error).message,
      })
    }
  }

  /**
   * Forget a side chat the Host no longer has.
   * @param parentSessionId - main Session id.
   * @param childSessionId - the vanished side chat.
   */
  forget(parentSessionId: string, childSessionId: string): void {
    const current = this.entry(parentSessionId)
    if (current.childSessionId !== childSessionId) return
    this.remember(parentSessionId, undefined)
    this.patch(parentSessionId, { creating: false })
  }

  /** Send one prompt; rejects with the Host's error message. */
  async prompt(parentSessionId: string, sessionId: string, text: string): Promise<void> {
    await post(PROMPT_PATH, { parentSessionId, sessionId, text, requestId: globalThis.crypto.randomUUID() })
  }

  /** Interrupt the running side-chat turn. */
  async cancel(sessionId: string): Promise<void> {
    await post(CANCEL_PATH, { sessionId })
  }

  /** A replaced Connection may reach another Host: re-ask what is live. */
  reset(): void {
    this.reconciled.clear()
  }
}
