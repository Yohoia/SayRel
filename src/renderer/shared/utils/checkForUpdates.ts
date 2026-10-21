import { z } from 'zod'
import { api } from './bridge'
import { toast } from '../components/Toast'

const updateResult = z.object({ version: z.string().nullable().optional(), skipped: z.string().optional(), error: z.string().optional() })

export async function checkForUpdates(currentVersion: string): Promise<void> {
  const id = toast.loading("Checking for updates")
  try {
    const result = updateResult.parse(await api.updater.check())
    if (result.skipped === 'dev-build') toast.update(id, { tone: 'info', message: "Automatic updates are unavailable in development mode" })
    else if (result.error) toast.update(id, { tone: 'error', message: "Could not check for updates. Please try again later." })
    else if (result.version === currentVersion) toast.update(id, { tone: 'success', message: "You’re up to date" })
    else if (result.version) toast.update(id, { tone: 'info', message: `New version available: v${result.version}` })
    else toast.update(id, { tone: 'info', message: "Could not confirm the latest version" })
  } catch { toast.update(id, { tone: 'error', message: "Could not check for updates. Please check your connection." }) }
}
