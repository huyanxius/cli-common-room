# cli-common-room
A lightweight shared chat interface for native Claude Code and Codex CLI sessions. Planning stage; no application implemented yet.

一个终端群聊窗口，连接本机原生 Claude Code 与 Codex。终端优先，网页后置；不重新实现 Agent 的工具或认证。

## 设计文档

- [产品 Proposal](docs/PROPOSAL.md)：使用方式、范围、取舍和验收标准。
- [架构与开发顺序](docs/ARCHITECTURE.md)：模块边界、原生接入、消息交付、权限与恢复。

当前仅有待用户过目的设计文档，没有可运行程序，也没有已验证的 CLI 兼容性声明。具体依赖和版本尚未锁定。

开发按小任务走 Issue、分支、验证和 PR；不额外设置设计评审流程。个人配置、凭据、会话记录和私人记忆不提交到公开仓库。
