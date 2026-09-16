import { StdioRpc, type RpcOptions } from '../../runtime/stdio-rpc.js'

export async function initializeCodex(rpc: StdioRpc): Promise<{ userAgent: string }> {
  const result = await rpc.request('initialize', {
    clientInfo: { name: 'cli-common-room', title: 'CLI Common Room', version: '0.0.0' },
    capabilities: { experimentalApi: false, requestAttestation: false },
  })
  if (!result || typeof result !== 'object' || !('userAgent' in result) || typeof result.userAgent !== 'string' || !result.userAgent.trim()) {
    throw new Error('Codex 握手响应不兼容')
  }
  rpc.notify('initialized')
  // 新版本还返回 codexHome；诊断不向终端或日志转发个人配置路径。
  return { userAgent: result.userAgent }
}

export async function checkCodex(command = 'codex', options: RpcOptions = {}): Promise<void> {
  const rpc = new StdioRpc(command, ['app-server', '--listen', 'stdio://'], options)
  try { await initializeCodex(rpc) }
  finally { await rpc.close() }
}
