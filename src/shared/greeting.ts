// Identical copy in ProjectMobile: src/core/greeting.ts

/**
 * Home's greeting: a different one each time, fitting the time of day (and sometimes the day of the
 * week), with the person's name when we know it. "{n}" is the name; lines with it are skipped
 * when there's no name.
 */
const BY_TIME: { from: number; to: number; lines: string[] }[] = [
  {
    from: 0,
    to: 5,
    lines: ['Up late, {n}?', 'Late night session, {n}', 'Still awake, {n}?', 'Night owl mode', 'Quiet hours, loud headphones', 'Something soft for the small hours?', 'The city sleeps, {n} listens'],
  },
  {
    from: 5,
    to: 9,
    lines: ['Early start, {n}', 'Good morning, {n}', 'Rise and shine, {n}', 'Coffee and a soundtrack?', 'Morning, {n}', 'Up with the sun'],
  },
  {
    from: 9,
    to: 12,
    lines: ['Good morning, {n}', 'Morning, {n}', 'What are we starting with, {n}?', 'Set the tone for today', 'Back at it, {n}', 'Fresh day, fresh queue'],
  },
  {
    from: 12,
    to: 17,
    lines: ['Good afternoon, {n}', 'Afternoon, {n}', 'Back at it, {n}', 'Midday mix, {n}?', 'Keep the afternoon moving', 'What’s playing, {n}?', 'Afternoon soundtrack time'],
  },
  {
    from: 17,
    to: 21,
    lines: ['Good evening, {n}', 'Evening, {n}', 'Winding down, {n}?', 'Golden hour, good songs', 'How was today, {n}?', 'Evening set, {n}'],
  },
  {
    from: 21,
    to: 24,
    lines: ['Night, {n}', 'Late evening, {n}', 'One more song, {n}?', 'Lights low, volume up', 'Night drive playlist?', 'Still going, {n}'],
  },
]

const BY_DAY: Record<number, string[]> = {
  0: ['Easy Sunday, {n}', 'Sunday mood, {n}?'],
  1: ['New week, {n}', 'Monday, but make it sound good'],
  5: ['Friday, {n}!', 'Weekend’s almost here, {n}'],
  6: ['Saturday, {n}', 'Weekend mode, {n}'],
}

const ANYTIME = ['Welcome back, {n}', 'Hey {n}', 'Back at it, {n}', 'Ready when you are, {n}', 'What’s next, {n}?']

/** The name to greet: the first word of the display name, else the @username, else none. */
export function greetingName(displayName?: string | null, handle?: string | null) {
  const first = displayName?.trim().split(/\s+/)[0]
  return first || handle || null
}

/** A greeting for now. `random` is for tests. */
export function pickGreeting(name: string | null, now = new Date(), random = Math.random) {
  const h = now.getHours()
  const slot = BY_TIME.find((s) => h >= s.from && h < s.to) ?? BY_TIME[0]!
  // mostly the time of day; now and then the day of the week or a general one
  const pool = [...slot.lines, ...slot.lines, ...(BY_DAY[now.getDay()] ?? []), ...(h >= 6 && h < 23 ? ANYTIME : [])]
  const usable = pool.filter((l) => name || !l.includes('{n}'))
  const line = usable[Math.floor(random() * usable.length)] ?? 'Hello'
  return name ? line.replace('{n}', name) : line
}
