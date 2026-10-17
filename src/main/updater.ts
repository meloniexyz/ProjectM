import { app, net, type WebContents } from 'electron'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'

export interface UpdateInfo {
  version: string
  /** the version installed now */
  current: string
  notes: string
  page: string
  installer: string
  size: number
}

const REPO = 'meloniexyz/ProjectM'

/** "1.10.0" > "1.9.2" */
export function newer(a: string, b: string) {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return false
}

/** The latest GitHub release, if it's newer than this ProjectM and has a Windows installer. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  // the dev app isn't installed; PROJECTM_UPDATE_FROM pretends to be an older version to test this
  const current = process.env.PROJECTM_UPDATE_FROM ?? (app.isPackaged ? app.getVersion() : null)
  if (!current) return null
  const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(`GitHub ${res.status}`)
  const r = (await res.json()) as {
    tag_name: string
    body?: string
    html_url: string
    draft: boolean
    prerelease: boolean
    assets: { name: string; browser_download_url: string; size: number }[]
  }
  if (r.draft || r.prerelease || !newer(r.tag_name, current)) return null
  const exe = r.assets.find((a) => /^ProjectM-Setup-.*\.exe$/i.test(a.name))
  if (!exe) return null
  return { version: r.tag_name.replace(/^v/, ''), current, notes: r.body ?? '', page: r.html_url, installer: exe.browser_download_url, size: exe.size }
}

/** Downloads the installer, runs it silently (same folder, "only for me"), and reopens ProjectM when it's done. */
export async function installUpdate(u: UpdateInfo, sender: WebContents) {
  if (!u.installer.startsWith(`https://github.com/${REPO}/releases/download/`)) throw new Error('Unexpected download address')
  const file = join(app.getPath('temp'), `ProjectM-Setup-${u.version}.exe`)
  const res = await net.fetch(u.installer)
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)
  const total = Number(res.headers.get('content-length')) || u.size
  const out = createWriteStream(file)
  const reader = res.body.getReader()
  let got = 0
  let last = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    got += value.length
    if (!out.write(value)) await new Promise((r) => out.once('drain', r))
    if (Date.now() - last > 200) {
      last = Date.now()
      sender.send('update:progress', total ? got / total : 0)
    }
  }
  await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())))
  if (total && got < total) throw new Error('the download was cut off, try again')
  sender.send('update:progress', 1)
  // the same switches electron-updater uses: install silently, then start the new version
  spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
  setTimeout(() => app.quit(), 300)
}
