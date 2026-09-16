import { createApplication } from './app.js'
import { renderStatus } from './terminal/status.js'

const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '--help') {
  console.log('用法：npm start -- [--status | --check-codex | --help]\n\n--status  查看成员接入状态（默认）\n--check-codex  检查原生连接（可加 --codex-bin 程序路径）\n--help    显示帮助\n\n当前版本只提供架构骨架，尚未接入原生会话。')
} else if (args[0] === '--check-codex' && (args.length === 1 || (args.length === 3 && args[1] === '--codex-bin' && args[2]?.trim()))) {
  try {
    await createApplication().checkCodexConnection(args[2])
    console.log('Codex 原生协议握手成功。未创建聊天或发送模型请求；完整群聊尚未接入。')
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Codex 原生连接失败')
    process.exitCode = 1
  }
} else if (args.length === 0 || (args.length === 1 && args[0] === '--status')) {
  console.log(renderStatus(createApplication().agents))
} else {
  console.error('不支持此命令。使用 --help 查看当前可用命令。')
  process.exitCode = 2
}
