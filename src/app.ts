import { checkCodex } from './adapters/codex/check.js'
import { nativeAgents } from './adapters/index.js'
import { RoomService } from './room/service.js'

export function createApplication() {
  const agents = nativeAgents()
  return { agents, room: new RoomService(agents), checkCodexConnection: checkCodex }
}
