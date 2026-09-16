import type { Quota, Usage } from '../room/telemetry.js'
const number = (value: number): string => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
export function quotaLines(quotas: Quota[]): string[] {
  if (!quotas.length) return ['订阅额度：未提供']
  return quotas.map(quota => `${quota.name} · ${quota.windows.map(window => {
    const label = window.minutes === 300 ? '5h' : window.minutes === 10080 ? '7d' : window.minutes === null ? '窗口未知' : `${window.minutes}m`
    const reset = window.resetsAt === null ? '' : ` · ${new Date(window.resetsAt * 1000).toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} 重置`
    return `${label} 已用 ${window.usedPercent}%${reset}`
  }).join('  /  ')}`)
}
export function tokenLine(usage: Usage | undefined): string {
  if (!usage) return 'Tokens：等待原生用量'
  const context = usage.contextWindow ? ` · 上轮 ${number(usage.last)}/${number(usage.contextWindow)} (${Math.round(100 * usage.last / usage.contextWindow)}%)` : ''
  return `Tokens ${number(usage.total)} · in ${number(usage.input)} · cache ${number(usage.cached)} · out ${number(usage.output)}${context}`
}

export function quotaMeters(quotas: Quota[], size = 8): string {
  return quotas.flatMap(quota => quota.windows.map(window => {
    const label = window.minutes === 300 ? '5h' : window.minutes === 10080 ? '7d' : window.minutes === null ? '额度' : `${window.minutes}m`
    const used = Number.isFinite(window.usedPercent) ? window.usedPercent : null
    if (used === null) return `${quota.name} ${label} 未知`
    const cells = Math.round(Math.max(0, Math.min(100, used)) / 100 * size)
    const reset = window.resetsAt === null ? '' : ` ↻ ${new Date(window.resetsAt * 1000).toLocaleString(undefined, { ...(window.minutes === 300 ? {} : { month: '2-digit', day: '2-digit' }), hour: '2-digit', minute: '2-digit', hour12: false })}`
    return `${quota.name === '订阅' ? '' : quota.name + ' '}${label} ${'━'.repeat(cells)}${'┄'.repeat(size - cells)} ${used}% 已用${reset}`
  })).join('   ')
}
