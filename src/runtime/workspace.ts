import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execute = promisify(execFile)
export async function workspaceStatus(cwd: string): Promise<string> {
  try {
    const { stdout } = await execute('git', ['status', '--porcelain=v1', '--branch', '--untracked-files=normal'], { cwd, timeout: 2000, maxBuffer: 1_048_576 })
    const lines = stdout.trimEnd().split('\n')
    const gitDir = await execute('git', ['rev-parse', '--git-dir', '--git-common-dir'], { cwd, timeout: 2000 })
    const [local, common] = gitDir.stdout.trim().split('\n')
    return `${lines[0]?.replace(/^## /, '') ?? 'detached'} · ${lines.length > 1 ? `${lines.length - 1} changed` : 'clean'}${local !== common ? ' · worktree' : ''}`
  } catch { return 'Git 状态不可用 / 非 Git 目录' }
}

export async function workspaceDiff(cwd: string): Promise<string> {
  const outputs = await Promise.all([[], ['--cached']].map(extra => execute('git', ['diff', '--no-ext-diff', '--no-textconv', ...extra], { cwd, timeout: 5000, maxBuffer: 2_097_152 })))
  return outputs.map((result, index) => `${index ? 'Staged' : 'Working tree'}\n${result.stdout || '无差异'}`).join('\n\n')
}
