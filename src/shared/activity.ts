import { z } from 'zod'

export const historyActivitySchema = z.object({
  days: z.array(z.object({ date: z.iso.date(), count: z.number().int().nonnegative() }))
})
export type HistoryActivity = z.infer<typeof historyActivitySchema>

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function calendarDay(key: string): number {
  return Date.parse(key + 'T00:00:00Z') / 86400000
}

export function buildActivity(activity: HistoryActivity, now = new Date()) {
  const today = localDateKey(now)
  const counts = new Map<string, number>()
  for (const day of activity.days) {
    if (day.date <= today && day.count > 0) counts.set(day.date, (counts.get(day.date) ?? 0) + day.count)
  }
  const activeDates = [...counts.keys()].sort()
  let longestStreak = 0, streak = 0, previous = -Infinity
  for (const date of activeDates) {
    const day = calendarDay(date)
    streak = day === previous + 1 ? streak + 1 : 1
    longestStreak = Math.max(longestStreak, streak)
    previous = day
  }
  let currentStreak = 0
  let cursor = calendarDay(today)
  if (!counts.has(today)) cursor--
  while (counts.has(new Date(cursor * 86400000).toISOString().slice(0, 10))) {
    currentStreak++
    cursor--
  }
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() - 25 * 7)
  const days = Array.from({ length: 26 * 7 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
    const key = localDateKey(date)
    const count = counts.get(key) ?? 0
    return { date, key, count, future: key > today, level: count === 0 ? 0 : count < 3 ? 1 : count < 6 ? 2 : count < 10 ? 3 : 4 }
  })
  return { days, today, activeDays: counts.size, currentStreak, longestStreak }
}

export type ActivitySummary = ReturnType<typeof buildActivity>
