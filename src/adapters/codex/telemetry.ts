import type { Quota, Usage } from '../../room/telemetry.js'
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {}
const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
export function readUsage(value: unknown): Usage | undefined {
  const usage = obj(value), total = obj(usage.total), last = obj(usage.last)
  if (![total.totalTokens, total.inputTokens, total.cachedInputTokens, total.outputTokens, total.reasoningOutputTokens, last.totalTokens].every(valid)) return undefined
  return { total: total.totalTokens as number, input: total.inputTokens as number, cached: total.cachedInputTokens as number, output: total.outputTokens as number, reasoning: total.reasoningOutputTokens as number, last: last.totalTokens as number, contextWindow: valid(usage.modelContextWindow) ? usage.modelContextWindow : null }
}
export function readQuotas(value: unknown): Quota[] {
  const response = obj(value)
  const buckets = response.rateLimitsByLimitId && typeof response.rateLimitsByLimitId === 'object' ? Object.values(response.rateLimitsByLimitId) : [response.rateLimits]
  return buckets.flatMap(raw => {
    const bucket = obj(raw)
    const windows = [bucket.primary, bucket.secondary].flatMap(rawWindow => {
      const window = obj(rawWindow)
      if (!valid(window.usedPercent)) return []
      return [{ usedPercent: window.usedPercent, minutes: valid(window.windowDurationMins) ? window.windowDurationMins : null, resetsAt: valid(window.resetsAt) ? window.resetsAt : null }]
    })
    return windows.length ? [{ name: String(bucket.limitName ?? bucket.limitId ?? '订阅') + (typeof bucket.planType === 'string' ? ` (${bucket.planType})` : ''), windows }] : []
  })
}
