import { nativeImage, type BrowserWindow, type NativeImage } from 'electron'

/**
 * Previous / play-pause / next buttons under the window's taskbar preview (Windows "thumbnail
 * toolbar"), like Spotify's. The renderer reports play state; clicks are sent back to it.
 */

type Shape = { kind: 'rect'; x0: number; y0: number; x1: number; y1: number } | { kind: 'tri'; pts: [number, number][] }

/** Draws white shapes (in a 0..1 box) into a transparent icon, 4x supersampled for smooth edges. */
function icon(shapes: Shape[]): NativeImage {
  const size = 32 // 16px at 200%; Windows scales it down cleanly at 100%
  const ss = 4
  const buf = Buffer.alloc(size * size * 4)
  const inside = (x: number, y: number) =>
    shapes.some((s) => {
      if (s.kind === 'rect') return x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1
      const [[ax, ay], [bx, by], [cx, cy]] = s.pts
      const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by)
      const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy)
      const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay)
      return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
    })
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) if (inside((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size)) hits++
      const a = Math.round((hits / (ss * ss)) * 255)
      const i = (py * size + px) * 4
      // BGRA, premultiplied: white at alpha a
      buf[i] = buf[i + 1] = buf[i + 2] = buf[i + 3] = a
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 })
}

let icons: Record<'prev' | 'play' | 'pause' | 'next', NativeImage> | null = null
const getIcons = () =>
  (icons ??= {
    prev: icon([
      { kind: 'rect', x0: 0.2, y0: 0.22, x1: 0.31, y1: 0.78 },
      { kind: 'tri', pts: [[0.8, 0.22], [0.8, 0.78], [0.33, 0.5]] },
    ]),
    play: icon([{ kind: 'tri', pts: [[0.28, 0.18], [0.28, 0.82], [0.82, 0.5]] }]),
    pause: icon([
      { kind: 'rect', x0: 0.25, y0: 0.2, x1: 0.42, y1: 0.8 },
      { kind: 'rect', x0: 0.58, y0: 0.2, x1: 0.75, y1: 0.8 },
    ]),
    next: icon([
      { kind: 'tri', pts: [[0.2, 0.22], [0.2, 0.78], [0.67, 0.5]] },
      { kind: 'rect', x0: 0.69, y0: 0.22, x1: 0.8, y1: 0.78 },
    ]),
  })

export type PlayerCommand = 'prev' | 'toggle' | 'next'

export function updateThumbar(win: BrowserWindow, state: { playing: boolean; hasTrack: boolean }) {
  if (process.platform !== 'win32' || win.isDestroyed()) return
  const i = getIcons()
  const send = (cmd: PlayerCommand) => () => win.webContents.send('player:command', cmd)
  const flags = state.hasTrack ? [] : (['disabled'] as const)
  const ok = win.setThumbarButtons([
    { tooltip: 'Previous', icon: i.prev, click: send('prev'), flags: [...flags] },
    { tooltip: state.playing ? 'Pause' : 'Play', icon: state.playing ? i.pause : i.play, click: send('toggle'), flags: [...flags] },
    { tooltip: 'Next', icon: i.next, click: send('next'), flags: [...flags] },
  ])
  if (!ok) console.warn('[thumbar] Windows refused the taskbar buttons')
  else if (process.env.PROJECTM_DATA) console.log('[thumbar] buttons set', state)
}
