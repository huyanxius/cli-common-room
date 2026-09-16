import { PassThrough } from 'node:stream'
import { emitKeypressEvents, type Key } from 'node:readline'
// 粘贴与按键分流：粘贴里的 Enter 永远不能执行命令或提交授权。
export class TerminalInput {
  private stream = new PassThrough()
  private buffer = ''
  private paste: string | null = null
  private mouseBuffer = ''
  private escapeTimer: ReturnType<typeof setTimeout> | undefined
  constructor(private readonly onKey: (text: string, key: Key) => void, private readonly onPaste: (text: string) => void, private readonly onScroll: (delta: number) => void = () => {}) {
    emitKeypressEvents(this.stream)
    this.stream.on('keypress', onKey)
  }
  feed(chunk: string): void {
    clearTimeout(this.escapeTimer)
    this.buffer += chunk
    const begin = '\x1b[200~', end = '\x1b[201~'
    while (this.buffer) {
      const marker = this.paste === null ? begin : end
      const index = this.buffer.indexOf(marker)
      if (index >= 0) {
        const text = this.buffer.slice(0, index)
        if (this.paste === null) { this.keys(text); this.paste = '' }
        else { this.onPaste(this.paste + text); this.paste = null }
        this.buffer = this.buffer.slice(index + marker.length)
      } else {
        let keep = 0
        for (let length = 1; length < marker.length; length++) if (this.buffer.endsWith(marker.slice(0, length))) keep = length
        const text = this.buffer.slice(0, this.buffer.length - keep)
        if (this.paste === null) this.keys(text)
        else this.paste = (this.paste + text).slice(0, 100_000)
        this.buffer = this.buffer.slice(this.buffer.length - keep)
        if (this.buffer === '\x1b' && this.paste === null) this.escapeTimer = setTimeout(() => { this.buffer = ''; this.onKey('', { name: 'escape', sequence: '\x1b' }) }, 35)
        break
      }
    }
  }
  private keys(text: string): void {
    this.mouseBuffer += text
    while (this.mouseBuffer) {
      const start = this.mouseBuffer.indexOf('\x1b[<')
      if (start < 0) { this.stream.write(this.mouseBuffer); this.mouseBuffer = ''; return }
      if (start > 0) this.stream.write(this.mouseBuffer.slice(0, start))
      this.mouseBuffer = this.mouseBuffer.slice(start)
      const match = /^\x1b\[<(\d+);\d+;\d+([Mm])/.exec(this.mouseBuffer)
      if (!match) {
        if (this.mouseBuffer.length > 64 || !/^\x1b\[<[\d;]*$/.test(this.mouseBuffer)) { this.mouseBuffer = ''; }
        return
      }
      const button = Number(match[1])
      if (match[2] === 'M' && (button & 64)) this.onScroll((button & 1) ? -3 : 3)
      this.mouseBuffer = this.mouseBuffer.slice(match[0].length)
    }
  }
  close(): void { clearTimeout(this.escapeTimer); this.stream.destroy(); this.buffer = ''; this.paste = null }
}
