# Side chat — design notes

Target: DeepSeek Harness 0.2.1-rc.2 (web client). Plugin id `side-chat`.

## Shape

- **Entry point**: one right-sidebar tab type (`sidebarRightTabs.register`,
  kind `side-chat`). It shows up in the sidebar's new-tab menu / guide. There is
  no header, composer or toolbar button. "New" lives inside the tab body.
- **Host routes** (Connection Fetch, all `no-store`):
  `POST /api/side-chat.create`, `POST /api/side-chat.prompt`,
  `POST /api/side-chat.cancel`, `POST /api/side-chat.close`,
  `GET /api/side-chat.list?parentSessionId=`.
- **Session**: id `session-sidechat-<uuid>`, created with `ctx.agents.create`,
  meta `{ cwd, parentSession, origin: 'subagent', isSeeded, agentPreset }`, no
  `parentAgent`. A `subagent/descriptor` (version 3, one-shot, provider
  `side-chat`) is appended to the side chat's own log so the shipped
  subagent address / history paging works. Nothing is written to the main log.
- **Seed**: `observeSession(main)` -> latest completed-turn boundary (same rule
  as `session.fork`) -> exact prefix + `session/end-seed {inherited: true}`.
  Without a completed turn the side chat starts with an empty seed.
- **Client**: `sessions.retain(child address)` + `SessionProvider` +
  `renderFactorySlot('conversation.content', { variant: 'embedded' })` inside
  the tab; `conversation.composer` chain entry at priority -20 that only
  matches side-chat ids (before the shipped subagent read-only composer at
  -10). The composer has no permission selector.
- **New**: creates a fresh side chat from the latest completed turn and closes
  the previous live agent; the previous log stays on disk. The conversation
  remounts for the new child id and focuses its input.

## Read-only enforcement (layers)

1. `tools.restrict({ allow })` per agent, allow-list = `read, glob, grep,
   read_image, web_search, web_fetch, skill` (intersected with what exists).
2. Per-agent `tools.guard`: anything outside the allow-list returns a refusal
   text (`This is a read-only side chat: the tool "<name>" is not available...`).
3. Global `ctx.tools.guard` keyed on the `session-sidechat-` id prefix, for
   any resume path this plugin does not own.
4. `permissionPresets.set(session, 'read-only')`.
5. A system prompt section `side-chat:read-only` that tells the model which
   tools exist.

Both setup paths (create and resume) run the same composition, so the limits
are re-applied after a Host restart.

Every prompt checks the parent association before reusing a foreign live
agent or sharing an in-flight resume. `scripts/host.test.mjs` exercises both
paths and the global tool guard with an isolated Host mock, without model calls.

## Findings from testing (uncertain points)

- **`restrict()` does not hide tools registered into the agent's own scope.**
  When a model-selection setting is active, the delegation tool `subagent` is
  registered on the agent's own tool layer; `restrict()` only filters the
  inherited layers. So `subagent` stays visible to the side-chat model. It is
  refused by the guard (layers 2/3) and the prompt section tells the model not
  to call it. Fallback chosen: guard + prompt section; no attempt to patch core.
- **Listing after restart**: the in-memory map is empty after a Host restart,
  so `list` also scans `sessionQuery.listSessions()` for headers with the
  side-chat prefix, `origin: 'subagent'` and matching `parentSession`. The
  side chat resumes on its next prompt under this plugin's composition.
- **Hidden from the left session tree**: `origin: 'subagent'` without a
  catalog entry keeps it out of the list; verified across restarts.
- **Main log untouched**: no `subagent/catalog`, no notification, no inbox
  event is written to the parent session.
- **Guard test mode**: `hideUnavailableTools: false` keeps every tool visible
  and drops the prompt section, so the model actually calls write/shell/MCP
  tools and the guard refusal can be observed. Only for testing.
- **Browser state**: the last opened side chat per main session is remembered
  in `localStorage`, which is per origin (host + port); the server-side `list`
  is the source of truth when it is missing.
- **Test isolation**: `~/.dsh/storages` and `~/.dsh/sessions` are shared across
  profiles, so tests ran with `DSH_HOME` pointing at a throwaway directory.
- In a profile `cordis.patch.yml`, a new plugin entry must be wrapped in
  `- insert:`; a bare `- id:` only patches an existing entry.

## Known limits

- The `subagent` tool remains visible (but refused) in the side chat.
- Web tools (`web_search`, `web_fetch`) are allowed; they read from the network
  but do not change the workspace.
- A `skill` call can load skill text; skills that ask for shell or file
  changes still hit the guard.
