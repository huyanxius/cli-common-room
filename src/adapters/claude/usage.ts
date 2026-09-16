import type { Quota } from '../../room/telemetry.js'
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
export function readClaudeQuotas(value: unknown): Quota[] {
  const limits = record(value), quotas: Quota[] = []
  const append = (name: string, minutes: number | null, raw: unknown): void => {
    const row = record(raw)
    if (typeof row.utilization !== 'number' || !Number.isFinite(row.utilization)) return
    const reset = typeof row.resets_at === 'string' ? Date.parse(row.resets_at) / 1000 : NaN
    quotas.push({ name, windows: [{ minutes, usedPercent: row.utilization, resetsAt: Number.isFinite(reset) ? reset : null }] })
  }
  append('订阅', 300, limits.five_hour)
  append('订阅', 10080, limits.seven_day)
  for (const [key, name] of [['seven_day_opus', 'Opus'], ['seven_day_sonnet', 'Sonnet'], ['seven_day_oauth_apps', 'OAuth apps']] as const) append(name, 10080, limits[key])
  if (Array.isArray(limits.model_scoped)) for (const item of limits.model_scoped) { const row = record(item); if (typeof row.display_name === 'string' && !quotas.some(quota => quota.name === row.display_name)) append(row.display_name, 10080, row) }
  return quotas
}
