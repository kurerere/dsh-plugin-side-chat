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

const CREATE_PATH = '/api/side-chat.create'

function hostCreate(events) {
  const routes = new Map()
  const created = []
  const ctx = {
    effect() {},
    get() {},
    logger: { warn() {}, debug() {} },
    tools: { guard() {} },
    connection: { fetch: { register: route => routes.set(route.path, route.fetch) } },
    sessionQuery: {
      observeSession: async () => ({ header: { id: 'session-main', cwd: 'C:/w' }, events }),
    },
    agents: {
      get: () => undefined,
      create: async options => {
        created.push(options)
        return { agent: { id: options.sessionId, session: { append() {} } } }
      },
    },
  }
  apply(ctx, { agentPreset: 'standard', label: 'Side chat', hideUnavailableTools: true })
  return {
    created,
    create: () => routes.get(CREATE_PATH)(new Request('http://localhost' + CREATE_PATH, {
      method: 'POST',
      body: JSON.stringify({ parentSessionId: 'session-main' }),
    })),
  }
}

const ev = (type, seq, data, extra) => ({ type, seq, time: 1000 + seq, data, ...extra })
const userMessage = seq => ev('user/message', seq, {
  id: `user-${seq}`, role: 'user', content: [{ type: 'text', text: `message ${seq}` }], source: { kind: 'user' },
}, { surfaceOp: 'append' })

test('create inside an open turn seeds the log tail with forked closers', async () => {
  const events = [
    ev('turn/start', 0, { turn: 1 }),
    userMessage(1),
    ev('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }),
    ev('turn/start', 3, { turn: 2 }),
    userMessage(4),
    ev('step/start', 5, { turn: 2, step: 1 }),
    ev('assistant/message', 6, {
      turn: 2, step: 1, stream: [],
      message: {
        id: 'assistant-6', role: 'assistant', source: { kind: 'model' },
        content: [
          { type: 'text', text: 'working' },
          { type: 'tool-call', id: 'c1', name: 'read', arguments: '{}' },
          { type: 'tool-call', id: 'c2', name: 'read', arguments: '{}' },
        ],
      },
    }, { surfaceOp: 'append' }),
    ev('tool/call', 7, { turn: 2, step: 1, callId: 'c1', name: 'read', arguments: '{}' }),
  ]
  const h = hostCreate(events)
  const response = await h.create()
  assert.equal(response.status, 200)
  const seed = h.created[0].seed
  assert.equal(seed.length, 13)
  for (const [index, event] of events.entries()) assert.equal(seed[index], event)
  // Regression for the reported bug: the running turn's user message is inherited.
  assert.equal(seed[4].type, 'user/message')
  const [marker, started, notStarted, stepEnd, turnEnd] = seed.slice(8)
  assert.deepEqual(marker, {
    type: 'session/end-seed', seq: 8, time: 1007, data: { inherited: true },
  })
  assert.equal(started.type, 'tool/result')
  assert.equal(started.seq, 9)
  assert.equal(started.surfaceOp, 'append')
  assert.deepEqual(started.sourceEventSeqs, [7])
  assert.equal(started.data.turn, 2)
  assert.equal(started.data.step, 1)
  assert.deepEqual(started.data.error, { name: 'ToolOutcomeUnknownError', code: 'TOOL_OUTCOME_UNKNOWN' })
  assert.equal(started.data.message.role, 'tool')
  assert.equal(started.data.message.toolCallId, 'c1')
  assert.equal(started.data.message.isError, true)
  assert.equal(started.data.message.id, 'forked-tool-result-c1-9')
  assert.deepEqual(started.data.message.source, { kind: 'tool', callId: 'c1' })
  assert.match(started.data.message.content[0].text, /records this tool call starting/)
  assert.equal(notStarted.type, 'tool/result')
  assert.equal(notStarted.seq, 10)
  assert.equal(notStarted.surfaceOp, 'append')
  assert.equal('sourceEventSeqs' in notStarted, false)
  assert.deepEqual(notStarted.data.error, { name: 'ToolNotStartedError', code: 'TOOL_NOT_STARTED' })
  assert.equal(notStarted.data.message.id, 'forked-tool-result-c2-10')
  assert.equal(notStarted.data.message.toolCallId, 'c2')
  assert.match(notStarted.data.message.content[0].text, /no record of this tool call starting/)
  assert.deepEqual(stepEnd, { type: 'step/end', seq: 11, time: 1007, data: { turn: 2, step: 1 } })
  assert.deepEqual(turnEnd, { type: 'turn/end', seq: 12, time: 1007, data: { turn: 2, reason: { kind: 'forked' } } })
  assert.equal(h.created[0].inheritedEventCount, 8)
  assert.equal((await response.json()).inheritedEvents, 8)
})

test('create inside an open turn inherits the running turn\'s messages', async () => {
  const events = [
    ev('turn/start', 0, { turn: 1 }),
    userMessage(1),
    ev('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }),
    ev('turn/start', 3, { turn: 2 }),
    userMessage(4),
  ]
  const h = hostCreate(events)
  const response = await h.create()
  assert.equal(response.status, 200)
  const seed = h.created[0].seed
  // The bug cut here at seq 2: user message 2 (seq 4) was missing from the seed.
  assert.equal(seed[4], events[4])
  assert.equal(seed[4].type, 'user/message')
  assert.equal(seed[5].type, 'session/end-seed')
  assert.deepEqual(seed.at(-1), {
    type: 'turn/end', seq: 6, time: 1004, data: { turn: 2, reason: { kind: 'forked' } },
  })
  assert.equal(h.created[0].inheritedEventCount, 5)
})

test('create on an idle log keeps the completed-prefix boundary', async () => {
  const events = [
    ev('turn/start', 0, { turn: 1 }),
    userMessage(1),
    ev('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }),
    ev('session/title', 3, { title: 't' }),
  ]
  const h = hostCreate(events)
  const response = await h.create()
  assert.equal(response.status, 200)
  const seed = h.created[0].seed
  assert.equal(seed.length, 5)
  for (const [index, event] of events.entries()) assert.equal(seed[index], event)
  assert.deepEqual(seed[4], {
    type: 'session/end-seed', seq: 4, time: 1003, data: { inherited: true },
  })
  assert.equal(h.created[0].inheritedEventCount, 4)
  assert.equal((await response.json()).inheritedEvents, 4)
})

test('create on a log without turns passes no seed', async () => {
  const h = hostCreate([ev('session/title', 0, { title: 't' })])
  const response = await h.create()
  assert.equal(response.status, 200)
  assert.equal(h.created[0].seed, undefined)
  assert.equal(h.created[0].inheritedEventCount, undefined)
  assert.equal((await response.json()).inheritedEvents, 0)
})
