import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RoomArchive } from '../src/storage/archive.js'

test('房间恢复限制在同工作区，同一记录不能被两个入口写入', async () => {
  const root = await mkdtemp(join(tmpdir(), 'room-archive-'))
  const first = new RoomArchive('/workspace/a', root)
  const second = new RoomArchive('/workspace/a', root)
  const other = new RoomArchive('/workspace/b', root)
  try {
    await first.save({ version: 1, history: [], bindings: [], uncertain: [] })
    assert.equal((await second.list()).length, 1)
    assert.equal((await other.list()).length, 0)
    await assert.rejects(second.load(first.id), /使用/)
    await first.release()
    assert.deepEqual(await second.load(first.id), { version: 1, history: [], bindings: [], uncertain: [] })
    await assert.rejects(other.load(first.id), /不存在|工作区/)
  } finally { await first.release(); await second.release(); await other.release(); await rm(root, { recursive: true, force: true }) }
})
