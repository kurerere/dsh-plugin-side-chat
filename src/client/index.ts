/**
 * dsh-plugin-side-chat — browser face.
 *
 * - Registers a right-sidebar tab type (`side-chat`) whose body shows the
 *   side chat of the Session the sidebar belongs to. The tab is the only
 *   entry point: it is opened from the right sidebar's new-tab menu.
 * - Retains the side-chat Session through its subagent-style address and
 *   renders the shipped Conversation content inside the tab.
 * - Takes over the composer for side-chat Sessions (priority below the
 *   shipped subagent read-only composer) and sends prompts through the Host
 *   routes of this plugin.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import { isSideChatId } from '../shared.ts'
import {
  SideChatComposer, SideChatConversation, SideChatTab,
  type SideChatComposerInjected, type SideChatComposerMatch, type SideChatTabInjected,
} from './mounts.tsx'
import { SideChatModel } from './model.ts'
import { en, NS, zh, type SideChatKey } from './locales.ts'
import STYLES from './styles.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Side chat copy. */
    'side-chat': SideChatKey
  }
}

/** Stable tab implementation id (also the body slot key). */
const TAB_ID = 'dsh-plugin-side-chat'
/** Right-sidebar tab kind. */
const TAB_KIND = 'side-chat'
/** Package id stamped on the injected style tag. */
const STYLE_ID = 'dsh-plugin-side-chat'
/** Before the shipped subagent read-only composer (-10), so side chats keep a live composer. */
const COMPOSER_PRIORITY = -20

/** Required browser services. */
export const inject = ['slots', 'locale', 'sessions']

function selectSideChat(owner: ComposerChainProps): SideChatComposerMatch | null {
  const sessionId = owner.sessionId
  if (sessionId === undefined || !isSideChatId(sessionId)) return null
  const parentSessionId = owner.session?.subagent?.address.parentSessionId
  if (parentSessionId === undefined) return null
  return { sessionId, parentSessionId }
}

/**
 * Client plugin body.
 * @param ctx - browser root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'side-chat: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const tag = document.createElement('style')
    tag.dataset.plugin = STYLE_ID
    tag.textContent = STYLES
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'side-chat: stylesheet')

  const model = new SideChatModel()
  ctx.on('connection/reset', () => { model.reset() })

  const composerFace: SideChatComposerInjected = {
    prompt: (parent, session, text) => model.prompt(parent, session, text),
    cancel: session => model.cancel(session),
  }
  ctx.slots.inject('conversation.composer', () => ctx.slots.register({
    name: 'conversation.composer',
    priority: COMPOSER_PRIORITY,
    locale: NS,
    select: selectSideChat,
    inject: () => composerFace,
  }, SideChatComposer))

  ctx.slots.inject('side-chat.conversation', () => ctx.slots.register({
    name: 'side-chat.conversation',
  }, SideChatConversation))

  const tabFace: SideChatTabInjected = {
    hooks: { sideChats: model.store },
    load: (parent) => { model.load(parent) },
    create: parent => model.create(parent),
    forget: (parent, child) => { model.forget(parent, child) },
    // Host and Client faces type-check in one program; `ctx.sessions` here is the Client ISessions.
    retain: target => (ctx.sessions as unknown as ISessions).retain(target, { source: 'sideChat' }),
  }

  // The dock surface is optional: without the right sidebar this plugin
  // contributes nothing visible rather than failing to mount.
  ctx.inject(['sidebarRightTabs'], (dock: ClientContext) => {
    dock.effect(() => dock.sidebarRightTabs.register({
      id: TAB_ID,
      kind: TAB_KIND,
      title: () => t('tab.title'),
      guide: [{ id: 'side-chat', order: 55, title: () => t('tab.title'), description: () => t('tab.guideDescription') }],
    }), 'side-chat: tab type')

    dock.effect(() => dock.slots.inject('sidebar.right.pane.tab', () => dock.slots.register({
      name: 'sidebar.right.pane.tab',
      key: TAB_ID,
      locale: NS,
      children: { 'side-chat.conversation': { kind: 'single', scope: 'session' } },
      inject: () => tabFace,
    }, SideChatTab)), 'side-chat: tab body')
  })
}
