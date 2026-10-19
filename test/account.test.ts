// Account client against a running projectm-server: in projectm-server run
// `npx wrangler dev --port 8799 --local`, then `API=http://127.0.0.1:8799 npm test` here.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { changePassword, downloadCover, fetchHistory, knownFrom, localFields, logIn, mergeFields, mergeMatches, syncMatches, type SongMatch, ownerReset, recover, relayDone, relayDownload, relayReport, relayUpload, sendHistory, setAccountServer, signUp, songKey, syncPlatforms, syncPlaylists, syncSettings, uploadCover, type AccountSession } from '../src/shared/account'
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

  test('settings: newest change per setting wins; settings a device lacks are kept', () => {
    const local = { fields: { theme: { v: 'amoled', at: 10 }, accent: { v: '#f00', at: 50 } } }
    const remote = { fields: { theme: { v: 'nord', at: 40 }, accent: { v: '#0f0', at: 20 }, uiStyle: { v: 'glass', at: 5 } } }
    const r = mergeFields(local, remote)
    assert.deepEqual(r.take, ['theme'])
    assert.equal(r.merged.fields.accent.v, '#f00')
    assert.equal(r.merged.fields.uiStyle.v, 'glass') // iPhone-only, kept by the PC
    assert.ok(r.upload)
    assert.equal(mergeFields(r.merged, r.merged).upload, null)
    // changes are noticed by comparing with what was synced last time
    const known = knownFrom(r.merged)
    assert.equal(localFields({ theme: 'nord' }, known, 999).fields.theme.at, 40)
    assert.equal(localFields({ theme: 'crimson' }, known, 999).fields.theme.at, 999)
    // a device that never synced takes the account's value instead of overwriting it
    assert.equal(localFields({ theme: 'crimson' }, {}, 999).fields.theme.at, 0)
    assert.deepEqual(mergeFields(localFields({ theme: 'crimson' }, {}, 999), remote).take, ['theme'])
  })

  test('look settings, history and platform sign-ins reach the second device', async () => {
    const email = `stage2-${now}@example.com`
    const { session: pc } = await signUp(email, 'password123', dev('pc'))
    const phone = await logIn(email, 'password123', dev('phone'))
    await syncSettings(pc, 'look', () => localFields({ theme: 'nord', accent: '#ff4d5e' }, { theme: { json: '"x"', at: 1 }, accent: { json: '"x"', at: 1 } }))
    const got = await syncSettings(phone, 'look', () => ({ fields: {} }))
    assert.deepEqual(got.merged.fields.accent.v, '#ff4d5e')
    // platforms: encrypted with the account key; the other device decrypts them
    await syncPlatforms(pc, () => localFields({ soundcloud: { id: 1, username: 'me' } }, {}))
    const plat = await syncPlatforms(phone, () => ({ fields: {} }))
    assert.deepEqual(plat.merged.fields.soundcloud.v, { id: 1, username: 'me' })
    // history: a play on the phone shows on the PC
    const play = { id: 'h1', track: track('1'), startedAt: now, endedAt: now + 60000, segments: [[0, 60]] as [number, number][], listened: 60, duration: 100 }
    await sendHistory(phone, { entries: [play] })
    const h = await fetchHistory(pc, 0)
    assert.deepEqual(h.entries.map((e) => e.id), ['h1'])
  })

  test('song matches: the first pick on any device wins, everywhere', async () => {
    const m = (id: string, at: number): SongMatch => ({ source: 'youtube', id, title: 'T', artist: 'A', duration: 100, at })
    // merge rules alone
    const r = mergeMatches({ s1: m('later', 20), s2: m('mine', 5) }, { s1: m('first', 10) })
    assert.equal(r.merged.s1.id, 'first')
    assert.equal(r.merged.s2.id, 'mine')
    assert.deepEqual(Object.keys(r.take), ['s1'])
    assert.ok(r.upload)
    assert.equal(mergeMatches({ s1: m('first', 10) }, { s1: m('first', 10) }).upload, null)
    // through the server: the phone picked first, the PC picked a different recording later
    const email = `match-${Date.now()}@example.com`
    const { session: pc } = await signUp(email, 'password123', dev('pc'))
    const phone = await logIn(email, 'password123', dev('phone'))
    await syncMatches(phone, () => ({ 'spotify:x': m('phone-pick', 1000) }))
    const got = await syncMatches(pc, () => ({ 'spotify:x': m('pc-pick', 2000) }))
    assert.equal(got.take['spotify:x'].id, 'phone-pick')
    const again = await syncMatches(phone, () => ({ 'spotify:x': m('phone-pick', 1000) }))
    assert.equal(again.merged['spotify:x'].id, 'phone-pick')
  })

  test('local song relay through the client', async () => {
    const { session: pc } = await signUp(`relay-${now}@example.com`, 'password123', dev('pc'))
    const phone = await logIn(`relay-${now}@example.com`, 'password123', dev('phone'))
    const key = songKey('My Song (Remix)', 'Me, Someone Else')
    assert.equal(key, songKey('my song remix', 'ME'))
    await relayReport(phone, [], [{ key, title: 'My Song', artist: 'Me', duration: 100 }])
    const plan = await relayReport(pc, [{ key, size: 5 }], [])
    assert.deepEqual(plan.uploads, [key])
    await relayUpload(pc, key, new Uint8Array([1, 2, 3, 4, 5]), 'audio/mpeg', 'My Song.mp3')
    const down = await relayDownload(phone, key)
    assert.equal(down?.name, 'My Song.mp3')
    assert.deepEqual(down?.bytes, new Uint8Array([1, 2, 3, 4, 5]))
    await relayDone(phone, key)
    assert.equal(await relayDownload(phone, key), null)
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
