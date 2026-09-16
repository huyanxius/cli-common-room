import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { MemberId } from '../room/context.js'
export interface SetupSettings { authSource?: 'inherit' | 'native'; completed: boolean; selected: MemberId | 'all'; binaries: Record<'codex' | 'claude', string> & { agy?: string } }
export class SetupPreferences {
  readonly path: string
  constructor(private readonly root = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'common-room'), env: NodeJS.ProcessEnv = process.env) {
    const account = createHash('sha256').update(JSON.stringify([env.CODEX_HOME || join(homedir(), '.codex'), env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')])).digest('hex').slice(0, 16)
    this.path = join(root, `setup-${account}.json`)
  }
  async load(): Promise<SetupSettings> {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8')) as SetupSettings
      if (typeof data.completed !== 'boolean' || !['codex', 'claude', 'agy', 'all'].includes(data.selected) || !valid(data.binaries?.codex) || !valid(data.binaries?.claude) || (data.binaries.agy !== undefined && !valid(data.binaries.agy))) throw new Error('配置格式无效')
      return { ...(data.authSource === 'native' ? { authSource: 'native' as const } : {}), completed: data.completed, selected: data.selected, binaries: { codex: data.binaries.codex, claude: data.binaries.claude, agy: data.binaries.agy ?? 'agy' } }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('无法读取 room 配置，请检查配置文件权限或格式')
      return { authSource: 'native', completed: false, selected: 'codex', binaries: { codex: 'codex', claude: 'claude' } }
    }
  }
  async save(settings: SetupSettings): Promise<void> {
    if (!valid(settings.binaries.codex) || !valid(settings.binaries.claude) || (settings.binaries.agy !== undefined && !valid(settings.binaries.agy))) throw new Error('程序路径无效')
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify({ ...(settings.authSource ? { authSource: settings.authSource } : {}), completed: settings.completed, selected: settings.selected, binaries: settings.binaries }) + '\n', { mode: 0o600 })
    await rename(temporary, this.path)
  }
}
function valid(value: unknown): value is string { return typeof value === 'string' && !!value.trim() && !/[\x00-\x1f\x7f]/.test(value) }
