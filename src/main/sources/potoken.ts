import { BrowserWindow, session } from 'electron'
import { UA } from './types'

/**
 * Mints YouTube "PO tokens" (proof of origin). Without one, YouTube serves only the first
 * ~1 MB of a song and then answers 403.
 *
 * The token comes from Google's BotGuard script, which only produces a working minter in a
 * real browser. So we run it in a hidden, sandboxed Chromium window (with its own session,
 * no Node access), the same way youtube.com itself does. Protocol details follow
 * bgutils-js (github.com/LuanRT/BgUtils).
 */

const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo'
const GOOG_API_KEY = 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw'

export interface BotGuardChallenge {
  program: string
  globalName: string
  interpreterUrl: string
}

/** Runs inside the hidden page. Kept as a plain function so it can be serialized with toString(). */
async function pageSetup(program: string, globalName: string, requestKey: string, apiKey: string) {
  const w = window as unknown as Record<string, any>
  const vm = w[globalName]
  if (!vm?.a) throw new Error('BotGuard unavailable')

  const snapshot = await new Promise<(cb: (r: string) => void, args: unknown[]) => void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('BotGuard load timed out')), 10_000)
    const noop = () => {}
    vm.a(
      program,
      (asyncSnapshot: (cb: (r: string) => void, args: unknown[]) => void) => {
        clearTimeout(timer)
        resolve(asyncSnapshot)
      },
      true,
      undefined,
      noop,
      [[], []],
      undefined,
      false,
      [noop, noop, noop, noop, noop],
    )
  })

  const signalOutput: unknown[] = []
  const bgResponse = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('BotGuard snapshot timed out')), 10_000)
    snapshot(
      (r) => {
        clearTimeout(timer)
        resolve(r)
      },
      [undefined, undefined, signalOutput, undefined],
    )
  })

  const res = await fetch('https://www.youtube.com/api/jnn/v1/GenerateIT', {
    method: 'POST',
    headers: {
      'content-type': 'application/json+protobuf',
      'x-goog-api-key': apiKey,
      'x-user-agent': 'grpc-web-javascript/0.1',
    },
    body: JSON.stringify([requestKey, bgResponse]),
  })
  const [integrityToken, ttl] = (await res.json()) as [string, number]
  if (!integrityToken) throw new Error(`no integrity token (HTTP ${res.status})`)

  const b64 = integrityToken.replace(/-/g, '+').replace(/_/g, '/').replace(/\./g, '=')
  const getMinter = signalOutput[0] as (token: Uint8Array) => Promise<unknown>
  if (typeof getMinter !== 'function') throw new Error('BotGuard gave no minter')
  const minter = await getMinter(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
  if (typeof minter !== 'function') throw new Error('BotGuard minter rejected (APF)')

  w.__projectmMint = async (binding: string) => {
    const bytes = (await minter(new TextEncoder().encode(binding))) as Uint8Array
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
  }
  return ttl
}

export class PoTokenMinter {
  private win: BrowserWindow | null = null
  private ready: Promise<void> | null = null
  private expiresAt = 0
  private tokens = new Map<string, string>()

  constructor(private readonly fetchChallenge: () => Promise<BotGuardChallenge>) {}

  /** A PO token bound to `binding` (the video id). Cached: one per video is enough. */
  async mint(binding: string): Promise<string> {
    if (!this.ready || Date.now() > this.expiresAt || this.win?.isDestroyed()) {
      this.tokens.clear()
      this.ready = this.init().catch((err) => {
        this.ready = null
        throw err
      })
    }
    await this.ready
    let token = this.tokens.get(binding)
    if (!token) {
      token = (await this.win!.webContents.executeJavaScript(
        `window.__projectmMint(${JSON.stringify(binding)})`,
      )) as string
      this.tokens.set(binding, token)
    }
    return token
  }

  private async init() {
    this.win?.destroy()
    const ses = session.fromPartition('persist:botguard')
    ses.setUserAgent(UA) // look like plain Chrome, not "Electron"
    const win = new BrowserWindow({
      show: false,
      webPreferences: { session: ses, sandbox: true, contextIsolation: true, backgroundThrottling: false },
    })
    this.win = win
    // Any tiny youtube.com page gives BotGuard the origin it expects.
    await win.loadURL('https://www.youtube.com/robots.txt')

    const challenge = await this.fetchChallenge()
    const interpreter = await (await fetch(`https:${challenge.interpreterUrl}`)).text()
    await win.webContents.executeJavaScript(`${interpreter}\n;0`)

    const args = [challenge.program, challenge.globalName, REQUEST_KEY, GOOG_API_KEY].map((a) => JSON.stringify(a))
    const ttl = (await win.webContents.executeJavaScript(`(${pageSetup.toString()})(${args.join(',')})`)) as number
    // refresh a bit before the integrity token expires (usually 12 h)
    this.expiresAt = Date.now() + Math.max(60, (ttl || 3600) - 600) * 1000
  }

  dispose() {
    this.win?.destroy()
    this.win = null
    this.ready = null
  }
}
