import { requireAdmin } from '../auth'
import PlayerManager from './PlayerManager'

export default async function PlayersPage() {
  await requireAdmin()
  return <PlayerManager />
}
