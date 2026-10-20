import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply } from '../lib/index.js'

const sessionId = 'session-sidechat-test'
const PROMPT_PATH = '/api/side-chat.prompt'

function host({ foreign = false } = {}) {
  const routes = new Map()
  const guards = []
  const prompts = []
  let finishResume
  let resumeStarted
  const started = new Promise(resolve => { resumeStarted = resolve })
  const resumed = new Promise(resolve => { finishResume = resolve })
  const agent = { id: sessionId, followup: message => prompts.push(message) }
  const ctx = {
    effect() {},
    get() {},
    logger: { warn() {}, debug() {} },
    tools: { guard: guard => guards.push(guard) },
    connection: { fetch: { register: route => routes.set(route.path, route.fetch) } },
    sessionQuery: {
      observeSession: async () => ({ header: { origin: 'subagent', parentSession: 'main-a' } }),
    },
    agents: {
      get: () => foreign ? agent : undefined,
      resume: async () => {
        resumeStarted()
        await resumed
        return { agent }
      },
    },
  }
  apply(ctx, { agentPreset: 'standard', label: 'Side chat', hideUnavailableTools: true })
  return {
    guards, prompts, started, finishResume,
    prompt: parentSessionId => routes.get(PROMPT_PATH)(new Request('http://localhost' + PROMPT_PATH, {
      method: 'POST',
      body: JSON.stringify({ sessionId, parentSessionId, text: 'hello' }),
    })),
  }
}

test('side-chat guard permits only the read-only tool list', () => {
  const { guards } = host()
  for (const name of ['read', 'glob', 'grep', 'read_image', 'web_search', 'web_fetch', 'skill']) {
    assert.equal(guards[0]({ agent: { id: sessionId }, name }), undefined)
  }
  for (const name of ['write', 'edit', 'pwsh', 'bash', 'run_code', 'subagent', 'send_message', 'mcp__marker__write_marker']) {
    assert.match(guards[0]({ agent: { id: sessionId }, name }), /read-only/)
    assert.equal(guards[0]({ agent: { id: 'main-a' }, name }), undefined)
  }
})

test('a foreign live agent still requires the matching parent', async () => {
  const h = host({ foreign: true })
  assert.equal((await h.prompt('main-b')).status, 403)
  assert.equal(h.prompts.length, 0)
  assert.equal((await h.prompt('main-a')).status, 200)
  assert.equal(h.prompts.length, 1)
})

test('a pending resume cannot be reused with a different parent', async () => {
  const h = host()
  const first = h.prompt('main-a')
  await h.started
  const second = h.prompt('main-b')
  await new Promise(setImmediate)
  h.finishResume()
  assert.equal((await first).status, 200)
  assert.equal((await second).status, 403)
  assert.equal(h.prompts.length, 1)
})
