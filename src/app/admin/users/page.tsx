import { requireAdmin } from '../auth'
import UserManager from './UserManager'

export default async function UsersPage() {
  await requireAdmin()
  return <UserManager />
}
