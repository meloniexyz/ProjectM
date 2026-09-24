import { BrowserWindow, session, type Cookie, type Session } from 'electron'
import { UA } from './types'

/**
 * Sign-in for services without a public login API (YouTube Music, SoundCloud): we show the
 * service's own login page in a window with its own persistent session, and wait until the
 * login cookie appears. The password is typed into the real site; we only keep the cookies,
 * which stay in that session on this PC (like a browser profile).
 */
export function accountSession(partition: string): Session {
  const ses = session.fromPartition(partition)
  ses.setUserAgent(UA) // look like regular Chrome so the login pages behave normally
  return ses
}

export function openLoginWindow(opts: {
  partition: string
  url: string
  title: string
  /** return true once the cookies show the user is signed in */
  isDone: (cookies: Cookie[], currentUrl: string) => boolean
}): Promise<void> {
  const ses = accountSession(opts.partition)
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 520,
      height: 760,
      title: opts.title,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: { session: ses, sandbox: true, contextIsolation: true },
    })
    let finished = false

    const check = async () => {
      if (finished || win.isDestroyed()) return
      const cookies = await ses.cookies.get({})
      if (opts.isDone(cookies, win.webContents.getURL())) {
        finished = true
        await ses.cookies.flushStore()
        win.close()
        resolve()
      }
    }
    const onCookie = () => void check()
    ses.cookies.on('changed', onCookie)
    win.webContents.on('did-navigate', onCookie)
    win.webContents.on('did-navigate-in-page', onCookie)
    win.on('closed', () => {
      ses.cookies.removeListener('changed', onCookie)
      if (!finished) reject(new Error('Login window was closed before signing in'))
    })
    win.loadURL(opts.url)
  })
}

export async function clearAccountSession(partition: string) {
  const ses = session.fromPartition(partition)
  await ses.clearStorageData()
  await ses.clearCache()
}
