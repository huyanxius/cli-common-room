import type { NativeCommand } from '../../room/conversation.js'
export const codexCommands: NativeCommand[] = [
  ['model', '选择模型'], ['effort', '设置推理强度'], ['usage', '订阅额度'],
  ['skills', '已加载 skills'], ['mcp', 'MCP 服务状态'], ['compact', '压缩当前上下文'],
  ['rename', '重命名原生线程'], ['review', '审查未提交改动；可指定审查要求'],
  ['permissions', '查看或更改本会话权限'], ['fast', '查看或切换服务速度'],
  ['plan', '切换计划模式：on / off'], ['apps', '已连接应用'], ['hooks', '原生 hooks'],
].map(([name, description]) => ({ name: name!, description: description! }))
