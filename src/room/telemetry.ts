export interface Quota { name: string; windows: { minutes: number | null; usedPercent: number; resetsAt: number | null }[] }
export interface Usage { total: number; input: number; cached: number; output: number; reasoning: number; last: number; contextWindow: number | null }
export interface Telemetry {
  model?: string
  provider?: string
  effort?: string
  approval?: string
  sandbox?: string
  threadId?: string
  usage?: Usage
  quotas?: Quota[]
  quotaError?: string
}
