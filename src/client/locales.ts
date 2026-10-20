/** `side-chat` namespace dictionaries (zh_CN source of truth, en_US mirror). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'side-chat'

export const zh = {
  'tab.title': '侧边聊天',
  'tab.guideDescription': '基于当前对话追问，不影响主会话；只读',
  'empty.title': '侧边聊天',
  'empty.body': '基于当前对话的已完成轮次追问或核对细节，不会影响主会话，也不会出现在会话列表中。',
  'empty.readonly': '只读：可以阅读和搜索文件、查阅网页，不能修改文件、执行命令或调用 MCP 工具。',
  'empty.start': '开始侧边聊天',
  'empty.starting': '正在创建…',
  'empty.noTurns': '当前对话还没有已完成的轮次，侧边聊天将从空白上下文开始。',
  'bar.readonly': '只读',
  'bar.inherited': '已继承 {count} 条事件',
  'bar.fresh': '空白上下文',
  'bar.new': '新建',
  'bar.newHint': '丢弃当前侧边聊天，基于主会话最新的已完成轮次重新开始',
  'composer.placeholder': '追问当前对话…（只读）',
  'composer.send': '发送',
  'composer.stop': '停止',
  'composer.footnote': '侧边聊天只读，不会修改文件或影响主会话',
  'error.create': '创建侧边聊天失败：{error}',
  'error.prompt': '发送失败：{error}',
  'error.cancel': '停止失败：{error}',
  'error.retry': '重试',
  'error.gone': '找不到这个侧边聊天，请新建一个。',
}

export type SideChatKey = keyof typeof zh

export const en: Record<SideChatKey, string> = {
  'tab.title': 'Side chat',
  'tab.guideDescription': 'Ask follow-ups about this conversation without changing it; read-only',
  'empty.title': 'Side chat',
  'empty.body': 'Ask follow-up questions or check details using this conversation\'s completed turns. The main session is not affected and the side chat stays out of the session list.',
  'empty.readonly': 'Read-only: it can read and search files and look things up on the web, but it cannot edit files, run commands or call MCP tools.',
  'empty.start': 'Start side chat',
  'empty.starting': 'Creating…',
  'empty.noTurns': 'This conversation has no completed turn yet; the side chat will start with an empty context.',
  'bar.readonly': 'Read-only',
  'bar.inherited': '{count} events inherited',
  'bar.fresh': 'Empty context',
  'bar.new': 'New',
  'bar.newHint': 'Discard this side chat and start again from the main session\'s latest completed turn',
  'composer.placeholder': 'Ask about this conversation… (read-only)',
  'composer.send': 'Send',
  'composer.stop': 'Stop',
  'composer.footnote': 'Side chat is read-only and never changes files or the main session',
  'error.create': 'Could not create the side chat: {error}',
  'error.prompt': 'Could not send: {error}',
  'error.cancel': 'Could not stop: {error}',
  'error.retry': 'Retry',
  'error.gone': 'This side chat no longer exists. Start a new one.',
}
