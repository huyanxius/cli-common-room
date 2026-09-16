import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quotaLines, tokenLine } from '../src/terminal/metrics.js'
import { wrap, width, fit } from '../src/terminal/text.js'
import { edit, emptyEditor } from '../src/terminal/editor.js'

test('限额按真实窗口标注，不把 primary 猜成 5h，不用未知值填零', () => {
  assert.deepEqual(quotaLines([]), ['订阅额度：未提供'])
  assert.match(quotaLines([{ name: 'code', windows: [{ minutes: 10080, usedPercent: 37, resetsAt: null }, { minutes: 300, usedPercent: 81, resetsAt: null }] }]).join(' '), /7d 已用 37%.*5h 已用 81%/)
  assert.match(quotaLines([{ name: 'other', windows: [{ minutes: 60, usedPercent: 12, resetsAt: null }] }]).join(' '), /60m 已用 12%/)
  assert.equal(tokenLine(undefined), 'Tokens：等待原生用量')
})
test('中文、组合字符与 emoji 不拆开；控制序列不能进入渲染', () => {
  assert.deepEqual(wrap('甲乙👩‍💻a', 4), ['甲乙', '👩‍💻a'])
  assert.equal(width('e\u0301'), 1)
  assert.equal(width(fit('甲乙丙', 5)), 5)
  assert.equal(wrap('\x1b]52;c;YQ==\x07hello\x1b[2J', 20).join(''), 'hello')
})
test('编辑按 grapheme 删除，历史草稿恢复，粘贴换行不发送', () => {
  let state = edit(emptyEditor(), { name: '', text: '甲👩‍💻乙' }).state
  state = edit(state, { name: 'left' }).state
  state = edit(state, { name: 'backspace' }).state
  assert.equal(state.text, '甲乙')
  const paste = edit(state, { name: 'paste', text: 'a\nb' })
  assert.equal(paste.submit, undefined)
  assert.equal(paste.state.text, '甲a\nb乙')
  const sent = edit(paste.state, { name: 'return' })
  assert.equal(sent.submit, '甲a\nb乙')
  state = edit(sent.state, { name: '', text: '草稿' }).state
  state = edit(state, { name: 'up' }).state
  assert.equal(state.text, '甲a\nb乙')
  assert.equal(edit(state, { name: 'down' }).state.text, '草稿')
})

import { renderScreen } from '../src/terminal/screen.js'
test('窄终端仍保留输入和状态，长历史不会挤掉输入框', () => {
  for (const [columns, rows] of [[100, 30], [40, 15], [20, 8]]) {
    const frame = renderScreen({ telemetry: { model: 'model' }, cwd: '/tmp/项目', git: 'main', status: 'Ready', messages: [{ role: '你', text: '长文本'.repeat(500) }], editor: emptyEditor(), scroll: 0, menu: [], promptTitle: '', seconds: 0 }, columns!, rows!)
    assert.equal(frame.lines.length, rows)
    assert.ok(frame.lines.every(line => width(line.text) <= columns! - 1))
    assert.ok(frame.lines.some(line => line.text.includes('>')))
    assert.ok(frame.cursor.row >= 1 && frame.cursor.row <= rows!)
    assert.ok(frame.cursor.column >= 1 && frame.cursor.column < columns!)
  }
})

import { TerminalInput } from '../src/terminal/input.js'
test('跨数据块的 bracketed paste 保留换行，不触发 return 按键', () => {
  const keys: string[] = [], pastes: string[] = []
  const input = new TerminalInput((_text, key) => keys.push(key.name ?? ''), text => pastes.push(text))
  input.feed('\x1b[20'); input.feed('0~甲\n/exit'); input.feed('\x1b[201'); input.feed('~')
  assert.deepEqual(pastes, ['甲\n/exit'])
  assert.deepEqual(keys, [])
  input.feed('\r')
  assert.deepEqual(keys, ['return'])
  input.close()
})

test('敏感问题的输入不进入渲染帧', () => {
  const editor = { ...emptyEditor(), text: 'secret-token', cursor: 12 }
  const frame = renderScreen({ secret: true, telemetry: {}, cwd: '/tmp', git: '', status: 'Approval', messages: [], editor, scroll: 0, menu: [], promptTitle: '认证输入', seconds: 0 }, 80, 24)
  assert.ok(!frame.lines.some(line => line.text.includes('secret-token')))
  assert.ok(frame.lines.some(line => line.text.includes('************')))
})
