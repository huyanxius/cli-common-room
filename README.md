# cli-common-room
A lightweight shared chat interface for native Claude Code and Codex CLI sessions.

一个终端群聊窗口，连接本机原生 Claude Code 与 Codex。终端优先，网页后置；不重新实现 Agent 的工具或认证。

## 设计文档

- [产品 Proposal](docs/PROPOSAL.md)：使用方式、范围、取舍和验收标准。
- [架构与开发顺序](docs/ARCHITECTURE.md)：模块边界、原生接入、消息交付、权限与恢复。

当前支持 Codex 单成员真实会话：连续消息、流式回复、工具事件，以及命令/文件授权和普通提问。Claude 和双成员群聊尚未接入。默认启动仅显示状态，只有显式进入聊天或连接检查才启动原生进程。

## 本地运行

使用 Node.js 22.14+（22.x），版本入口见 `.nvmrc`。

```sh
npm ci
npm run build
npm start
npm start -- --help
npm start -- --check-codex
npm start -- --codex-chat
```

`npm run typecheck` 检查类型，`npm test` 编译并运行上下文交付、会话隔离和终端入口测试。测试不调用真实模型，不使用个人配置。

`--check-codex` 完成原生协议握手后关闭进程，不创建聊天、不发送模型请求。可用 `--check-codex --codex-bin /path/to/codex` 指定可执行文件；程序继承当前环境，沿用已有 `CODEX_HOME` 等配置。成功只表示协议连接正常，不代表认证、模型或工具已经验证。当前握手实测版本为 Codex CLI 0.154.0-alpha.6.2。请求超过 10 秒会报超时并关闭连接；Terminal.app 实测曾出现一次超时，原命令重跑成功，原因尚未定位。程序不会自动重试或切换配置。

`--codex-chat` 在当前工作目录启动原生会话，沿用现有模型、工具、权限和配置，不设置免审批或禁用工具。输入 `/exit` 退出，回答中按 Ctrl+C 请求停止，再按一次关闭连接。超时或断线不会自动重发。原生线程由 Codex 保存，本应用尚不提供退出后恢复入口。

该入口要求交互终端。授权没有默认允许项；普通提问可选择选项或按原生规则填写答案。隐藏敏感输入和未识别的原生交互暂不支持，遇到时明确停止，不伪造答复。工具事件目前按原始结构展示，尚未实现参考布局中的全屏 TUI。

真实验证：同一线程两轮口令记忆、隔离文件的真实读取及工具事件、Terminal.app 发送与回复。授权选择、提问、取消和过期保护目前通过协议测试；未将其声明为真实授权验收。下一步接入 Claude，并将两侧会话接到统一群聊。


开发按小任务走 Issue、分支、验证和 PR；不额外设置设计评审流程。个人配置、凭据、会话记录和私人记忆不提交到公开仓库。
