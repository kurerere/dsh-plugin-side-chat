# dsh-plugin-side-chat

[English](./README.md)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）Web/桌面客户端插件：在右侧栏提供一个
**只读的侧边聊天**。它继承当前对话已完成的轮次，用来追问或核对细节，不会影响主会话。

## 使用方法

1. 打开一个对话，展开右侧栏（`Ctrl+Shift+B`）。
2. 在右侧栏的新建标签菜单中选择 **侧边聊天**。
3. 点击 **开始侧边聊天** 即可提问。标签栏中的 **新建** 会丢弃当前侧边聊天，基于主会话最新的已完成轮次重新开始。

插件不会添加其他按钮：右侧栏标签是唯一入口。

## 行为

- **继承上下文**：侧边聊天以主会话最新已完成轮次的前缀作为种子（与分叉相同的边界）。对话还没有已完成的轮次时，从空白上下文开始。
- **不影响主会话**：不向主会话日志写入任何内容（没有子智能体目录项，也没有通知），侧边聊天不会出现在会话列表中。
- **只读**：只允许 `read`、`glob`、`grep`、`read_image`、`web_search`、`web_fetch` 和 `skill`。修改文件、执行命令、运行代码、委派、发送消息以及所有 MCP 工具都会被拒绝。限制分多层：每个智能体的工具白名单、每个智能体的守卫、按侧边聊天 ID 前缀的全局守卫、`read-only` 权限预设，以及一段系统提示。重启后恢复侧边聊天时会重新套用这些限制。
- 侧边聊天在 Host 重启后仍保留，发送下一条消息时恢复。

## 安装

包内附带构建好的 `lib/`：

```sh
dsh plugin --profile desktop add github:kurerere/dsh-plugin-side-chat
```

重启 DeepSeek Harness 后加载插件。Web 配置请把 `--profile desktop` 换成
`--profile web`，然后启动 `dsh --profile web`。
卸载：`dsh plugin --profile desktop remove dsh-plugin-side-chat`。

## 配置

| 键 | 默认值 | |
|---|---|---|
| `agentPreset` | `standard` | 侧边聊天使用的智能体预设（未知时回退到默认预设）。 |
| `label` | `Side chat` | 写入侧边聊天日志的标签。 |
| `hideUnavailableTools` | `true` | 设为 `false` 时非只读工具对模型可见，但每次调用都会被守卫拒绝。仅用于测试守卫。 |

## 开发

```sh
pnpm install
pnpm run check        # 类型检查 + 构建 lib/ + 生成类型 + 校验产物 + Host 回归测试
```

## 兼容性

| | |
|---|---|
| 测试版本 | dsh **0.2.1-rc.2**，Web 客户端，Chromium |
| 声明范围 | `engines.dsh: >=0.2.1-rc.2 <0.3.0` |
| 客户端 | 仅 Web / 桌面（无 TUI 视图） |

## 已知限制

- 启用了模型选择设置时，委派工具 `subagent` 注册在智能体自身的工具层上，白名单无法隐藏它。模型能看到它，但每次调用都会被拒绝。
- 允许 `web_search` / `web_fetch`：它们会访问网络，但不会改动工作区。
- 每个对话最近打开的侧边聊天记在浏览器中；换浏览器或端口时通过 Host 重新找回。

设计说明见 [notes/design.md](notes/design.md)。

## 许可证

[MIT](./LICENSE) © yy wan
