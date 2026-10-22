import { useEffect, useState } from 'react'
import { z } from 'zod'
import { api } from '../../shared/utils/bridge'
const versionSchema = z.object({ appVersion: z.string() })

export function HomeFooter() {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void api.app.systemInfo().then((value: unknown) => {
      const result = versionSchema.safeParse(value)
      if (active && result.success) setVersion(result.data.appVersion)
    }).catch(() => undefined)
    return () => { active = false }
  }, [])
  return (
    <footer className="home-footer">
      <span className="home-credit">Builded By Yohoia</span>
      <div className="home-version">{version && <span>v{version}</span>}</div>
    </footer>
  )
}
