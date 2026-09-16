import { mkdir, open, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { RoomSnapshot } from '../room/live.js'
import { validateSnapshot } from '../room/live.js'
export class RoomArchive {
  id = randomUUID() as string
  private readonly directory: string
  private locked: string | undefined
  constructor(private readonly cwd: string, root = join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'common-room')) {
    const key = createHash('sha256').update(cwd + '\0' + (process.env.CODEX_HOME ?? '') + '\0' + (process.env.CLAUDE_CONFIG_DIR ?? '')).digest('hex').slice(0, 24)
    this.directory = join(root, key)
  }
  private path(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('无效房间 ID')
    return join(this.directory, id + '.json')
  }
  private async lock(id: string): Promise<void> {
    if (this.locked === id) return
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const path = this.path(id) + '.lock'
    try {
      const file = await open(path, 'wx', 0o600)
      await file.writeFile(String(process.pid)); await file.close()
      this.locked = id
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const pid = Number(await readFile(path, 'utf8'))
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('房间锁无法核对，请检查本机状态目录')
      try { process.kill(pid, 0) } catch (probe) {
        if ((probe as NodeJS.ErrnoException).code === 'ESRCH') { await unlink(path); return this.lock(id) }
        throw probe
      }
      throw new Error('该房间正在被另一个入口使用')
    }
  }
  async save(snapshot: RoomSnapshot): Promise<void> {
    validateSnapshot(snapshot)
    await this.lock(this.id)
    const path = this.path(this.id), temp = path + `.${process.pid}.tmp`
    await writeFile(temp, JSON.stringify({ cwd: this.cwd, updatedAt: new Date().toISOString(), snapshot }), { mode: 0o600 })
    await rename(temp, path)
  }
  async list(): Promise<Array<{ id: string; updatedAt: string; count: number }>> {
    let files: string[]
    try { files = await readdir(this.directory) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    const result: Array<{ id: string; updatedAt: string; count: number }> = []
    for (const file of files.filter(file => file.endsWith('.json'))) {
      try {
        const value = JSON.parse(await readFile(join(this.directory, file), 'utf8')) as { cwd: string; updatedAt: string; snapshot: RoomSnapshot }
        if (value.cwd !== this.cwd) continue
        validateSnapshot(value.snapshot)
        result.push({ id: file.slice(0, -5), updatedAt: value.updatedAt, count: value.snapshot.history.length })
      } catch { /* 损坏的档案不进入可恢复目录；不修改原文件。 */ }
    }
    return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  async load(id: string): Promise<RoomSnapshot> {
    let raw: string
    try { raw = await readFile(this.path(id), 'utf8') } catch { throw new Error('当前工作区不存在此房间') }
    const value = JSON.parse(raw) as { cwd: string; snapshot: RoomSnapshot }
    if (value.cwd !== this.cwd) throw new Error('房间属于另一个工作区')
    validateSnapshot(value.snapshot)
    await this.lock(id)
    this.id = id
    return value.snapshot
  }
  async release(): Promise<void> {
    if (!this.locked) return
    const id = this.locked; this.locked = undefined
    await unlink(this.path(id) + '.lock').catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error })
  }
}
