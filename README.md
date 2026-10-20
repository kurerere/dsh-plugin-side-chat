# dsh-plugin-side-chat

[中文](./README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) plugin for the Web/Desktop
client: a **read-only side chat** in the right sidebar. It inherits the current conversation's
completed turns so you can ask follow-up questions or check details without touching the main
session.

## How to use

1. Open a conversation and open the right sidebar (`Ctrl+Shift+B`).
2. From the sidebar's new-tab menu pick **Side chat**.
3. Click **Start side chat** and ask away. **New** in the tab bar discards the current side
   chat and starts again from the main session's latest completed turn.

There is no other button: the right-sidebar tab is the only entry point.

## Behaviour

- **Inherits context**: the side chat is seeded with the main session's latest completed-turn
  prefix (the same boundary as fork). A conversation without a completed turn gives an empty
  context.
- **Does not affect the main session**: nothing is written to the main session's log (no
  sub-agent catalog row, no notification), and side chats do not appear in the session list.
- **Read-only**: only `read`, `glob`, `grep`, `read_image`, `web_search`, `web_fetch` and
  `skill` are allowed. File edits, shell commands, code execution, delegation, messaging and
  every MCP tool are refused. Enforcement is layered: a per-agent tool allow-list, a per-agent
  guard, a global guard on the side-chat id prefix, the `read-only` permission preset, and a
  system prompt section. Limits are re-applied when a side chat resumes after a restart.
- Side chats survive a Host restart and are resumed on the next message.

## Install

The package ships prebuilt `lib/`:

```sh
dsh plugin --profile desktop add github:kurerere/dsh-plugin-side-chat
```

Restart DeepSeek Harness to load the plugin. For the Web profile, replace
`--profile desktop` with `--profile web` and start `dsh --profile web`.
Remove with `dsh plugin --profile desktop remove dsh-plugin-side-chat`.

## Configuration

| Key | Default | |
|---|---|---|
| `agentPreset` | `standard` | Agent preset for side chats (falls back to the default preset). |
| `label` | `Side chat` | Label recorded in the side chat's log. |
| `hideUnavailableTools` | `true` | When `false`, non read-only tools stay visible and every call is refused by the guard. For testing the guard only. |

## Development

```sh
pnpm install
pnpm run check        # typecheck + build lib/ + emit types + verify artifacts + Host regression tests
```

## Compatibility

| | |
|---|---|
| Tested with | dsh **0.2.1-rc.2**, web client, Chromium |
| Declared range | `engines.dsh: >=0.2.1-rc.2 <0.3.0` |
| Client | Web / Desktop only (no TUI view) |

## Known limitations

- When a model selection setting is active, the delegation tool `subagent` is registered on the
  agent's own tool layer, which the allow-list cannot hide. It stays visible to the model but
  every call is refused.
- `web_search` / `web_fetch` are allowed: they reach the network but do not change the workspace.
- The last opened side chat per conversation is remembered in the browser; another browser or
  port finds it again through the Host.

See [notes/design.md](notes/design.md) for the design decisions.

## License

[MIT](./LICENSE) © yy wan
