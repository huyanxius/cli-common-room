import { createApplication } from './app.js'
import { renderStatus } from './terminal/status.js'

const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '--help') {
  console.log('用法：npm start -- [--status | --help]\n\n--status  查看成员接入状态（默认）\n--help    显示帮助\n\n当前版本只提供架构骨架，尚未接入原生会话。')
} else if (args.length === 0 || (args.length === 1 && args[0] === '--status')) {
  console.log(renderStatus(createApplication().agents))
} else {
  console.error('不支持此命令。使用 --help 查看当前可用命令。')
  process.exitCode = 2
}
