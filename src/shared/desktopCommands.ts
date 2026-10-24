import { z } from 'zod'

export const desktopApps = {
  safari: { label: 'Safari', bundleId: 'com.apple.Safari', aliases: ['safari'] },
  finder: { label: 'Finder', bundleId: 'com.apple.finder', aliases: ['finder', '访达'] },
  notes: { label: 'Notes', bundleId: 'com.apple.Notes', aliases: ['notes', '备忘录'] },
  calendar: { label: 'Calendar', bundleId: 'com.apple.iCal', aliases: ['calendar', '日历'] },
  calculator: { label: 'Calculator', bundleId: 'com.apple.calculator', aliases: ['calculator', '计算器'] }
} as const

export const desktopActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('open_app'), app: z.enum(['safari', 'finder', 'notes', 'calendar', 'calculator']) }).strict(),
  z.object({ kind: z.literal('read_selection') }).strict(),
  z.object({ kind: z.literal('read_focused_app') }).strict()
])
export type DesktopAction = z.infer<typeof desktopActionSchema>
export const desktopPlanViewSchema = z.object({ id: z.string().uuid(), summary: z.string(), expiresAt: z.number() })
export type DesktopPlanView = z.infer<typeof desktopPlanViewSchema>

/** The first release accepts one explicit action; compound and ambiguous requests stay unexecuted. */
export function parseDesktopIntent(asrText: string): DesktopAction | null {
  const text = asrText.trim().replace(/[。.!！?？]+$/, '').toLocaleLowerCase()
  if (/^(?:请)?(?:读取|读出)(?:当前)?选中(?:的)?(?:文本|文字)$/.test(text) || /^(?:please )?read (?:the )?(?:selected text|selection)$/.test(text)) return { kind: 'read_selection' }
  if (/^(?:当前|现在)(?:是)?什么应用$/.test(text) || /^(?:what(?:'s| is) (?:the )?(?:current|focused) app|read (?:the )?focused app)$/.test(text)) return { kind: 'read_focused_app' }
  const match = /^(?:(?:please )?(?:open|switch to)\s+|(?:请)?(?:打开|切换到)\s*)(.+)$/.exec(text)
  if (!match) return null
  for (const [app, definition] of Object.entries(desktopApps)) {
    if (definition.aliases.some(alias => alias === match[1].trim())) return desktopActionSchema.parse({ kind: 'open_app', app })
  }
  return null
}
