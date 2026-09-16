export const commands = [
  ['queue', '消息队列 · resume 继续 / drop 撤回 / clear 清空'], ['setup', '成员配置与原生登录'], ['login', '登录 / 重新登录当前成员'],
  ['help', 'Common Room · 操作与快捷键'], ['status', '当前会话、工作树与详细用量'],
  ['model', '当前成员 · 列出模型；/model 名称切换'], ['effort', '当前成员 · 推理强度'],
  ['usage', '当前成员 · 刷新订阅额度'], ['skills', '当前成员 · 原生 skills'],
  ['mcp', '当前成员 · MCP 连接状态'], ['compact', '当前成员 · 原生上下文压缩'],
  ['new', '创建新房间，两位成员使用新的原生会话'],
  ['diff', '工作区与暂存区差异'],
  ['resume', '列出当前工作区房间；/resume ID 恢复'],
  ['to', '选择接收者：codex / claude / all'],
  ['clear', '新房间，重建原生上下文'], ['screen-clear', '仅清空可见消息，保留原生上下文'], ['exit', '退出 Common Room'],
] as const
export const matchingCommands = (input: string, native: readonly { name: string; description: string }[] = []): string[] => input.startsWith('/') && !input.includes(' ') ? [...commands.map(([name, description]) => ({ name, description })), ...native.filter(command => !commands.some(([name]) => name === command.name))].filter(command => `/${command.name}`.startsWith(input)).map(command => `/${command.name}  ${command.description}`) : []
