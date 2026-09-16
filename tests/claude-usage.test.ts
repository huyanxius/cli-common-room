import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readClaudeQuotas } from '../src/adapters/claude/usage.js'
test('Claude 原生额度按窗口和模型归属解析，不把附加消费字段当作订阅额度', () => {
  const quotas = readClaudeQuotas({ five_hour: { utilization: 33, resets_at: '2026-09-16T15:10:00Z' }, seven_day: { utilization: 25, resets_at: null }, nimbus_quill: { utilization: 0 }, extra_usage: { utilization: 70 }, model_scoped: [{ display_name: 'Opus', utilization: 12, resets_at: null }] })
  assert.deepEqual(quotas.map(q => [q.name, q.windows[0]!.minutes, q.windows[0]!.usedPercent]), [['订阅', 300, 33], ['订阅', 10080, 25], ['Opus', 10080, 12]])
  assert.equal(quotas[0]!.windows[0]!.resetsAt, Date.parse('2026-09-16T15:10:00Z') / 1000)
  assert.deepEqual(readClaudeQuotas(null), [])
  assert.deepEqual(readClaudeQuotas({ five_hour: { utilization: NaN } }), [])
})
