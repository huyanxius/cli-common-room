# cli-common-room

在一个终端窗口里与 Claude Code 和 Codex 共同工作。原生程序负责认证、模型、工具与记忆，Common Room 提供共享消息流、命令菜单、审批和会话恢复。

## 启动

安装 Node.js 22.14+（22.x）或 24.x，并确保本机 `codex`、`claude` 可用且已配置。

```sh
npm ci
npm run build
npm link
cd /path/to/your/project
room
```

不安装全局命令时，在仓库运行 `npm start`，或在目标工作目录运行 `/path/to/cli-common-room/bin/common-room.mjs`。`room` 以当前目录作为工作区，旧命令 `common-room` 保留兼容，不覆盖 `codex` 或 `claude`。

```sh
room --help
room --status
room --check-codex
room --codex-bin /path/to/codex --claude-bin /path/to/claude
```

程序继承当前环境，包括 `CODEX_HOME`、`CLAUDE_CONFIG_DIR`。Shell alias 不会自动变成子进程配置；alias 中的环境变量应在启动前导出，程序路径使用上面的参数。SDK 调用 PATH 中的本机 Claude Code，不使用 SDK 随包附带的另一份 CLI。没有免审批、禁用工具或替换认证的默认开关。

## 使用

默认选中 Codex，Claude 在首次选中时连接。

| 操作 | 命令或按键 |
| --- | --- |
| 选择接收者 | `/to codex`、`/to claude`、`/to all` |
| 浏览命令 | 输入 `/`；上下选择，Tab 补全 |
| 发送、换行 | Enter；Alt+Enter |
| 输入历史、编辑 | 上下键；左右、Home、End、Ctrl+A/E/U/K |
| 滚动消息 | Page Up / Page Down |
| 停止当前任务 | Ctrl+C；再次按下关闭连接 |
| 新房间 | `/new` 或 `/clear`，重建原生上下文 |
| 仅清空可见消息 | `/screen-clear` |
| 恢复房间 | `/resume` 列表，`/resume <ID>` 恢复 |
| 查看完整状态、差异 | `/status`、`/diff` |
| 退出 | `/exit` 或空闲时 Ctrl+C |

多行粘贴不会自动发送。命令只作用于当前单个成员；选择双方时先切到具体成员再操作。双方收到同一份讨论快照，依次执行，下一轮才接收另一位的回答。正文里偶然出现成员名称不会触发派发。

背景和正文继承终端主题，Codex 用紫色、Claude 用橙色强调。顶部显示真实模型、工作目录、Git 分支/工作树、权限和用量。订阅限额按原生返回的实际窗口展示，明确标注**已用**百分比和重置时间；没有数据时显示未提供，不填零。不同模型额度桶分别标名，不能把某一模型的 5h 额度当成整个订阅的额度。

## 原生命令

Claude 命令目录来自本机 CLI 的初始化响应，包括已加载的自定义 skills。`/model`、`/mcp`、`/usage` 使用结构化控制接口；目录中的其他命令在同一原生会话执行，文本与工具事件回到统一消息区。

Codex 使用 app-server 对应接口：`/model`、`/effort`、`/usage`、`/skills`、`/mcp`、`/compact`、`/rename`、`/review`、`/permissions`、`/fast`、`/plan`、`/apps`、`/hooks`。已加载 skills 加入命令菜单，也可以用 `$名称` 调用。`/permissions` 修改前需要明确确认；`/compact` 等待原生完成事件。

共同入口保留 `/help`、`/status`、`/to`、`/new`、`/clear`、`/screen-clear`、`/resume`、`/diff`、`/exit`。其中 `/resume` 恢复 Common Room 自己的房间，不导入其他入口的私人历史。原生终端专属、宿主注入或当前协议未提供的命令不会自动变成模型提示词，也不会跳转到原生 CLI 冒充完成；原生报告不支持时直接显示错误。命令目录可用不等于其每一种交互形式都已验证。

## 保存与错误处理

房间保存在 `${XDG_STATE_HOME:-~/.local/state}/common-room/`，按工作目录与原生配置目录隔离。目录权限 700、记录权限 600，包含本应用的群消息、原生会话引用和交付位置，不复制认证或原生会话数据库。

原子保存发生在发送前与收到原生结果后。异常中断留下的交付状态标为未知，恢复后阻止自动重发。文件锁防止两个 Common Room 入口同时恢复同一记录。取消不回滚已发生的工具操作；本应用无法阻止外部原生终端直接操作同一线程。

授权没有默认允许项，输入必须明确选择；提问在窗口内回答，敏感输入掩码显示。未识别的协议交互明确失败，不自动批准。Claude 的复杂多选提问目前通过文本填写多个选项；终端专用对话框仍取决于安装版本的程序化支持。

## 验证与开发

```sh
npm run typecheck
npm test
```

测试使用隔离协议夹具与 PTY，不调用真实模型或个人配置。真实验证使用 Terminal.app，不截图：双方同屏回复、Claude `/effort` 与 `/context`、双方关闭恢复后的口令记忆、Codex 真实文件读取。审批拒绝、粘贴、停止与过期保护通过协议或 PTY 测试，不将它们冒称为真实模型授权验收。

实测版本：Codex CLI `0.154.0-alpha.6.2`、Claude Code `2.1.241`，Claude SDK 锁定 `0.3.273`。订阅用量接口具有版本差异；Claude 结构化用量接口当前属于实验接口。程序不自动升级原生 CLI，不自动重试可能已执行的任务。Ghostty 和其他终端的实测后置。

- [产品 Proposal](docs/PROPOSAL.md)
- [代码架构](docs/ARCHITECTURE.md)
