import { PassThrough } from 'node:stream'
import { emitKeypressEvents, type Key } from 'node:readline'
// 粘贴与按键分流：粘贴里的 Enter 永远不能执行命令或提交授权。
export class TerminalInput {
  private stream = new PassThrough()
  private buffer = ''
  private paste: string | null = null
  constructor(onKey: (text: string, key: Key) => void, private readonly onPaste: (text: string) => void) {
    emitKeypressEvents(this.stream)
    this.stream.on('keypress', onKey)
  }
  feed(chunk: string): void {
    this.buffer += chunk
    const begin = '\x1b[200~', end = '\x1b[201~'
    while (this.buffer) {
      const marker = this.paste === null ? begin : end
      const index = this.buffer.indexOf(marker)
      if (index >= 0) {
        const text = this.buffer.slice(0, index)
        if (this.paste === null) { this.stream.write(text); this.paste = '' }
        else { this.onPaste(this.paste + text); this.paste = null }
        this.buffer = this.buffer.slice(index + marker.length)
      } else {
        let keep = 0
        for (let length = 1; length < marker.length; length++) if (this.buffer.endsWith(marker.slice(0, length))) keep = length
        const text = this.buffer.slice(0, this.buffer.length - keep)
        if (this.paste === null) this.stream.write(text)
        else this.paste = (this.paste + text).slice(0, 100_000)
        this.buffer = this.buffer.slice(this.buffer.length - keep)
        break
      }
    }
  }
  close(): void { this.stream.destroy(); this.buffer = ''; this.paste = null }
}
