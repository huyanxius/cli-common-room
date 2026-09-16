# cli-common-room
A lightweight shared chat interface for native Claude Code and Codex CLI sessions.

一个终端群聊窗口，连接本机原生 Claude Code 与 Codex。终端优先，网页后置；不重新实现 Agent 的工具或认证。

## 设计文档

- [产品 Proposal](docs/PROPOSAL.md)：使用方式、范围、取舍和验收标准。
- [架构与开发顺序](docs/ARCHITECTURE.md)：模块边界、原生接入、消息交付、权限与恢复。

当前提供可运行的架构骨架：可以查看成员接入状态，尚不能发送群聊消息。Claude Code 和 Codex 均明确显示未接入；默认启动不会启动原生进程或读取认证配置。显式连接检查会启动本机 Codex，由原生程序沿用自己的配置。

## 本地运行

使用 Node.js 22.14+（22.x），版本入口见 `.nvmrc`。

```sh
npm ci
npm run build
npm start
npm start -- --help
npm start -- --check-codex
```

`npm run typecheck` 检查类型，`npm test` 编译并运行上下文交付、会话隔离和终端入口测试。测试不调用真实模型，不使用个人配置。

`--check-codex` 完成原生协议握手后关闭进程，不创建聊天、不发送模型请求。可用 `--check-codex --codex-bin /path/to/codex` 指定可执行文件；程序继承当前环境，沿用已有 `CODEX_HOME` 等配置。成功只表示协议连接正常，不代表认证、模型或工具已经验证。当前握手实测版本为 Codex CLI 0.154.0-alpha.6.2。请求超过 10 秒会报超时并关闭连接；Terminal.app 实测曾出现一次超时，原命令重跑成功，原因尚未定位。程序不会自动重试或切换配置。

下一步在隔离材料上验证 Claude Code 流式接口与 Codex app-server 的真实会话、审批及取消，再接入群聊发送。

开发按小任务走 Issue、分支、验证和 PR；不额外设置设计评审流程。个人配置、凭据、会话记录和私人记忆不提交到公开仓库。
