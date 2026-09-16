# cli-common-room
A lightweight shared chat interface for native Claude Code and Codex CLI sessions.

一个终端群聊窗口，连接本机原生 Claude Code 与 Codex。终端优先，网页后置；不重新实现 Agent 的工具或认证。

## 设计文档

- [产品 Proposal](docs/PROPOSAL.md)：使用方式、范围、取舍和验收标准。
- [架构与开发顺序](docs/ARCHITECTURE.md)：模块边界、原生接入、消息交付、权限与恢复。

当前提供可运行的架构骨架：可以查看成员接入状态，尚不能发送群聊消息。Claude Code 和 Codex 均明确显示未接入；不会启动原生进程或读取认证配置。

## 本地运行

使用 Node.js 22.14+（22.x），版本入口见 `.nvmrc`。

```sh
npm ci
npm run build
npm start
npm start -- --help
```

`npm run typecheck` 检查类型，`npm test` 编译并运行上下文交付、会话隔离和终端入口测试。测试不调用真实模型，不使用个人配置。

下一步在隔离材料上验证 Claude Code 流式接口与 Codex app-server 的真实会话、审批及取消，再接入群聊发送。

开发按小任务走 Issue、分支、验证和 PR；不额外设置设计评审流程。个人配置、凭据、会话记录和私人记忆不提交到公开仓库。
