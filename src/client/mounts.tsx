/**
 * Slot mounts of the side chat:
 *
 * - {@link SideChatTab}: right-sidebar tab body. Owns the empty state, the
 *   read-only bar, and retains the side-chat Session for its Conversation.
 * - {@link SideChatConversation}: the shared Conversation content (message
 *   list + composer seat), instantiated for the retained side-chat Session.
 * - {@link SideChatComposer}: the composer takeover for side-chat Sessions.
 *   It talks to this plugin's routes and carries no permission control.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Button, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  InjectFace, PropsLocale, PropsRenderFactories, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionReference, SessionTarget } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SideChatState } from './model.ts'
import type { NS } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Session-scoped Conversation occurrence hosted by the side-chat tab. */
    'side-chat.conversation': { kind: 'single'; scope: 'session' }
  }
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    sideChat: unknown
  }
}

/** Registration-side business face of the tab body. */
export interface SideChatTabInjected {
  hooks: {
    /** Bound by the renderer as `useSideChats(selector)`. */
    sideChats: {
      getSnapshot(): SideChatState
      subscribe(listener: () => void): () => void
    }
  }
  load: (parentSessionId: string) => void
  create: (parentSessionId: string) => Promise<void>
  forget: (parentSessionId: string, childSessionId: string) => void
  retain: (target: SessionTarget) => SessionReference
}

export type SideChatTabProps =
  PropsRuntime<'sidebar.right.pane.tab'>
  & PropsRenderSlots<'side-chat.conversation'>
  & PropsLocale<typeof NS>
  & InjectFace<SideChatTabInjected>

function ChatIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.3"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 4.2A1.7 1.7 0 0 1 4.2 2.5h5.1A1.7 1.7 0 0 1 11 4.2v3.1A1.7 1.7 0 0 1 9.3 9H6.2L3.9 10.8V9h0a1.7 1.7 0 0 1-1.4-1.7Z" />
      <path d="M11 5.5h.8a1.7 1.7 0 0 1 1.7 1.7v3.1a1.7 1.7 0 0 1-1.4 1.7v1.5l-2-1.5H7.8a1.7 1.7 0 0 1-1.6-1.2" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
    </svg>
  )
}

/**
 * Right-sidebar tab body.
 * @param props - session-scoped tab props (the main Session) plus the injected face.
 * @returns the side chat for the main Session.
 */
export function SideChatTab({
  sessionId, useSideChats, load, create, forget, retain, SessionProvider, renderSlot, t,
}: SideChatTabProps) {
  const entry = useSideChats(state => state[sessionId])
  useEffect(() => { load(sessionId) }, [load, sessionId])
  const child = entry?.childSessionId
  const [reference, setReference] = useState<SessionReference | undefined>(undefined)

  useEffect(() => {
    if (child === undefined) {
      setReference(undefined)
      return undefined
    }
    const ref = retain({
      parentSessionId: sessionId as SessionId,
      childSessionId: child as SessionId,
      mode: 'unknown',
    })
    setReference(ref)
    let alive = true
    ref.ready.catch((error: unknown) => {
      // A side chat whose log vanished (deleted profile data, another Host).
      if (alive && /not.?found/i.test(String((error as { code?: unknown }).code ?? error))) forget(sessionId, child)
    })
    return () => {
      alive = false
      setReference(undefined)
      ref.release()
    }
  }, [sessionId, child, retain, forget])

  const creating = entry?.creating === true
  const error = entry?.error

  if (child === undefined || reference === undefined) {
    return (
      <div className="dshsch-root">
        <div className="dshsch-empty">
          <div className="dshsch-emptyIcon"><ChatIcon /></div>
          <div className="dshsch-emptyTitle">{t('empty.title')}</div>
          <p className="dshsch-emptyBody">{t('empty.body')}</p>
          <p className="dshsch-emptyNote"><LockIcon /><span>{t('empty.readonly')}</span></p>
          {error === undefined ? null : <p className="dshsch-error" role="alert">{t('error.create', { error })}</p>}
          <Button variant="primary" size="sm" disabled={creating || child !== undefined}
            onClick={() => { void create(sessionId) }}>
            {creating ? t('empty.starting') : t('empty.start')}
          </Button>
        </div>
      </div>
    )
  }

  const inherited = entry?.inheritedEvents
  return (
    <div className="dshsch-root" data-side-chat={child}>
      <div className="dshsch-bar">
        <span className="dshsch-badge"><LockIcon />{t('bar.readonly')}</span>
        {inherited === undefined
          ? null
          : <span className="dshsch-meta">{inherited === 0 ? t('bar.fresh') : t('bar.inherited', { count: String(inherited) })}</span>}
        <span className="dshsch-spacer" />
        {error === undefined ? null : <span className="dshsch-error" role="alert" title={error}>{t('error.create', { error })}</span>}
        <Tooltip label={t('bar.newHint')} side="bottom" delayMs={500}>
          <Button size="sm" disabled={creating} onClick={() => { void create(sessionId) }}>
            {creating ? t('empty.starting') : t('bar.new')}
          </Button>
        </Tooltip>
      </div>
      <div className="dshsch-conversation">
        <SessionProvider key={child} session={reference}>
          {renderSlot('side-chat.conversation', {})}
        </SessionProvider>
      </div>
    </div>
  )
}

/** Fixed Chat selection used by the embedded Conversation occurrence. */
function FixedChatConversationView(props: ConversationViewsProps) {
  return <>{props.renderSlot('conversation.session', { view: 'chat' })}</>
}

export type SideChatConversationProps = PropsRuntime<'side-chat.conversation'> & PropsRenderFactories

/**
 * Shared Conversation content for the retained side-chat Session. Never shows
 * the New Session hero: an unseeded side chat is an empty transcript.
 */
export function SideChatConversation({ useSession, renderFactorySlot }: SideChatConversationProps) {
  const openState = useSession(value => value.openState)
  const phase = openState === 'loading' ? 'settling' : 'active'
  return renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero: false }, {
    slots: { views: FixedChatConversationView },
  })
}

/** Composer chain match: the side chat and the main Session it belongs to. */
export interface SideChatComposerMatch {
  sessionId: string
  parentSessionId: string
}

export interface SideChatComposerInjected {
  prompt: (parentSessionId: string, sessionId: string, text: string) => Promise<void>
  cancel: (sessionId: string) => Promise<void>
}

export type SideChatComposerProps =
  PropsRuntime<'conversation.composer'>
  & { matched: SideChatComposerMatch }
  & PropsLocale<typeof NS>
  & InjectFace<SideChatComposerInjected>

/**
 * Minimal composer for side chats: text in, send / stop, nothing else (no
 * permission, plan, model or attachment controls).
 */
export function SideChatComposer({ matched, useSession, prompt, cancel, t }: SideChatComposerProps) {
  const running = useSession(value => value.running)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const composing = useRef(false)
  const area = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const node = area.current
    if (node === null) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, 200)}px`
  }, [text])

  const submit = (): void => {
    const value = text.trim()
    if (value === '' || sending) return
    setSending(true)
    setError(undefined)
    prompt(matched.parentSessionId, matched.sessionId, value).then(() => {
      setText('')
    }, (failure: unknown) => {
      setError(t('error.prompt', { error: (failure as Error).message }))
    }).finally(() => { setSending(false) })
  }

  const stop = (): void => {
    cancel(matched.sessionId).catch((failure: unknown) => {
      setError(t('error.cancel', { error: (failure as Error).message }))
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || composing.current || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (!running) submit()
  }

  const canSend = text.trim() !== '' && !sending && !running
  return (
    <div className="dshsch-composer">
      {error === undefined ? null : <div className="dshsch-composerError" role="alert">{error}</div>}
      <div className="dshsch-card">
        <textarea
          ref={area}
          autoFocus
          className="dshsch-input"
          rows={1}
          value={text}
          placeholder={t('composer.placeholder')}
          aria-label={t('composer.placeholder')}
          onChange={(event) => { setText(event.target.value) }}
          onKeyDown={onKeyDown}
          onCompositionStart={() => { composing.current = true }}
          onCompositionEnd={() => { composing.current = false }}
        />
        <div className="dshsch-row">
          <span className="dshsch-footnote"><LockIcon />{t('composer.footnote')}</span>
          {running
            ? (
              <Button variant="outline" size="sm" onClick={stop} aria-label={t('composer.stop')}>
                {t('composer.stop')}
              </Button>
            )
            : (
              <Button variant="primary" size="sm" disabled={!canSend} onClick={submit} aria-label={t('composer.send')}>
                {t('composer.send')}
              </Button>
            )}
        </div>
      </div>
    </div>
  )
}
