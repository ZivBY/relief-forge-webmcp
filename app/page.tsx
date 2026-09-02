import { requireChatGPTUser } from './chatgpt-auth'
import { ReliefForgeClient } from './relief-forge-client'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function Home() {
  if (process.env.NODE_ENV !== 'production') {
    return <ReliefForgeClient />
  }

  await requireChatGPTUser('/')
  return <ReliefForgeClient />
}
