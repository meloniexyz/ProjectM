// Account client against a running projectm-server: in projectm-server run
// `npx wrangler dev --port 8799 --local`, then `API=http://127.0.0.1:8799 npm test` here.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { changePassword, downloadCover, logIn, ownerReset, recover, setAccountServer, signUp, syncPlaylists, uploadCover, type AccountSession } from '../src/shared/account'
import type { Playlist, Track } from '../src/shared/types'

const API = process.env.API
const dev = (name: string) => ({ id: `test-${name}-${Math.random().toString(36).slice(2, 10)}`, name, platform: 'windows' as const })
const track = (id: string): Track => ({ uid: `spotify:${id}`, source: 'spotify', id, title: `Song ${id}`, artist: 'A', album: 'B', duration: 100 })
const pl = (id: string, updatedAt: number, ids: string[]): Playlist => ({ id, name: id, tracks: ids.map(track), createdAt: 1, updatedAt })

/** A device: its own playlists and deletions, synced like the app does. */
function device(session: AccountSession, playlists: Playlist[] = []) {
  const d = { session, playlists, deleted: {} as Record<string, number> }
  return {
    d,
    async sync() {
      const r = await syncPlaylists(d.session, () => ({ playlists: d.playlists, deleted: d.deleted }))
      d.deleted = r.deleted
      if (r.localChanged) d.playlists = r.playlists
      return r
    },
  }
}

describe('account client', { skip: !API && 'set API (wrangler dev of projectm-server)' }, () => {
  if (API) setAccountServer(API)
  const now = Date.now()

  test('playlists made on two devices end up on both', async () => {
    const email = `client-${now}@example.com`
    const { session: pcS, recoveryCode } = await signUp(email, 'password123', dev('pc'))
    assert.match(recoveryCode, /^[A-Z0-9]{4}(-[A-Z0-9]{4}){5}$/)
    const phoneS = await logIn(email, 'password123', dev('phone'))
    assert.equal(phoneS.accountKey, pcS.accountKey)

    const pc = device(pcS, [pl('gym', now, ['1', '2'])])
    const phone = device(phoneS, [pl('chill', now, ['3'])])
    await pc.sync()
    await phone.sync()
    await pc.sync()
    assert.deepEqual(pc.d.playlists.map((p) => p.id).sort(), ['chill', 'gym'])
    assert.deepEqual(phone.d.playlists.map((p) => p.id).sort(), ['chill', 'gym'])

    // newest edit wins
    phone.d.playlists = phone.d.playlists.map((p) => (p.id === 'gym' ? { ...p, tracks: [track('9')], updatedAt: now + 10 } : p))
    await phone.sync()
    await pc.sync()
    assert.deepEqual(pc.d.playlists.find((p) => p.id === 'gym')!.tracks.map((t) => t.id), ['9'])

    // deleted on one device: gone everywhere
    pc.d.playlists = pc.d.playlists.filter((p) => p.id !== 'chill')
    pc.d.deleted = { chill: now + 20 }
    await pc.sync()
    await phone.sync()
    assert.deepEqual(phone.d.playlists.map((p) => p.id), ['gym'])
  })

  test('two devices saving at the same moment both keep their changes', async () => {
    const email = `client2-${now}@example.com`
    const { session } = await signUp(email, 'password123', dev('pc'))
    const other = await logIn(email, 'password123', dev('phone'))
    const a = device(session, [pl('a', now, ['1'])])
    const b = device(other, [pl('b', now, ['2'])])
    await Promise.all([a.sync(), b.sync()])
    await Promise.all([a.sync(), b.sync()])
    assert.deepEqual(a.d.playlists.map((p) => p.id).sort(), ['a', 'b'])
    assert.deepEqual(b.d.playlists.map((p) => p.id).sort(), ['a', 'b'])
  })

  test('wrong password and short password', async () => {
    await assert.rejects(logIn(`client-${now}@example.com`, 'nope-nope', dev('x')), /Email or password is wrong/)
    await assert.rejects(signUp(`short-${now}@example.com`, 'short', dev('x')), /at least 8/)
  })

  test('forgot password: new one from a logged-in device, or with the recovery code; owner reset needs allowing', async () => {
    const email = `pw-${now}@example.com`
    const { session, recoveryCode } = await signUp(email, 'first-password', dev('pc'))
    await changePassword(session, 'second-password') // no old password needed on a logged-in device
    await assert.rejects(logIn(email, 'first-password', dev('x')), /wrong/)
    const phone = await logIn(email, 'second-password', dev('phone'))
    assert.equal(phone.accountKey, session.accountKey)
    const r = await recover(email, recoveryCode, 'third-password', dev('pc'))
    assert.equal(r.session.accountKey, session.accountKey)
    assert.notEqual(r.recoveryCode, recoveryCode)
    await assert.rejects(ownerReset(email, 'fourth-password', dev('pc')), /has not been allowed/)
  })

  test('covers upload and come back', async () => {
    const s = await logIn(`client-${now}@example.com`, 'password123', dev('pc2'))
    const img = new Uint8Array([0xff, 0xd8, 0xff, 9, 8, 7])
    const ref = await uploadCover(s, img, 'image/jpeg')
    assert.match(ref, /^projectm-cover:[0-9a-f]{64}$/)
    const back = await downloadCover(s, ref)
    assert.deepEqual(back?.bytes, img)
  })
})
