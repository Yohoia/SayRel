import { z } from 'zod'
import { api } from './bridge'
import { toast } from '../components/Toast'

const updateResult = z.object({ version: z.string().nullable().optional(), skipped: z.string().optional(), error: z.string().optional() })

export async function checkForUpdates(currentVersion: string): Promise<void> {
  const id = toast.loading('正在检查更新')
  try {
    const result = updateResult.parse(await api.updater.check())
    if (result.skipped === 'dev-build') toast.update(id, { tone: 'info', message: '开发模式暂不支持自动更新' })
    else if (result.error) toast.update(id, { tone: 'error', message: '检查更新失败，请稍后重试' })
    else if (result.version === currentVersion) toast.update(id, { tone: 'success', message: '已是最新版本' })
    else if (result.version) toast.update(id, { tone: 'info', message: `发现新版本 v${result.version}` })
    else toast.update(id, { tone: 'info', message: '暂时无法确认最新版本' })
  } catch { toast.update(id, { tone: 'error', message: '检查更新失败，请检查网络' }) }
}
