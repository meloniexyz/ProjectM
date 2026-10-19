import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { ShownProfile } from '../../../main/account-sync'
import { accountError, maskEmail, openAccountDialog, useProjectMAccount } from '../lib/account'
import { cls } from '../lib/format'
import { useNav } from '../lib/nav'
import { toast } from '../lib/ui'
import { Empty } from './common'
import { SearchIcon, UserIcon } from './Icons'
import { defaultProfileColor, inkOn } from '../../../shared/profile-colors'

const HANDLE_RULES = '3-20 letters, numbers, _ or . (no dot at the start or end)'
const MAX_DISPLAY_NAME = 32
const MAX_BIO = 190

/** Same rules as the server (shared/account.ts cleanHandle). */
const cleanHandle = (raw: string) => {
  const h = raw.trim().replace(/^@/, '').toLowerCase()
  return /^[a-z0-9_.]{3,20}$/.test(h) && !h.startsWith('.') && !h.endsWith('.') && !h.includes('..') ? h : null
}

/** What a profile shows as the name: the display name, else the @handle. Never the email (that stays private). */
export const shownName = (p: Pick<ShownProfile, 'displayName' | 'handle'> | undefined) => p?.displayName || (p?.handle ? `@${p.handle}` : 'Account')

const memberSince = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/** Profile photo, or (like Discord) the first letter of the name on the profile's own solid colour, or a person outline. */
export function AccountAvatar({ profile, size = 24 }: { profile?: Pick<ShownProfile, 'avatar' | 'displayName' | 'handle'>; size?: number }) {
  if (profile?.avatar) return <img className="account-avatar photo" src={profile.avatar} alt="" style={{ width: size, height: size }} />
  const letter = (profile?.displayName || profile?.handle || '')[0]
  const bg = defaultProfileColor(profile?.handle || profile?.displayName)
  return letter ? (
    <span className="account-avatar" style={{ width: size, height: size, fontSize: size * 0.45, background: bg, color: inkOn(bg) }}>
      {letter.toUpperCase()}
    </span>
  ) : (
    <span className="account-avatar no-account" style={{ width: size, height: size }}>
      <UserIcon size={size >= 40 ? size * 0.6 : size} />
    </span>
  )
}

/** The email as stars (c********@gmail.com) with a Show button; only in your account settings. */
export function PrivateEmail({ email }: { email: string }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="pcard-email">
      <span>{shown ? email : maskEmail(email)}</span>
      <button className="link" onClick={() => setShown((v) => !v)}>
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}

/**
 * A profile like Discord's: banner (image, else a solid colour), photo overlapping it, then the
 * name panel. Two profile colours tint the whole card from top to bottom.
 */
export function ProfileCard({ profile: p, actions, compact }: { profile: ShownProfile; actions?: ReactNode; compact?: boolean }) {
  const themed = !!p.colors
  const style = (themed ? { '--pc1': p.colors![0], '--pc2': p.colors![1] } : {}) as CSSProperties
  return (
    <div className={cls('pcard', themed && 'themed', compact && 'compact')} style={style}>
      {/* banner: the picture, else the primary profile colour, else the profile's own solid colour */}
      <div className="pcard-banner" style={p.banner ? { backgroundImage: `url("${p.banner}")` } : { backgroundColor: p.colors?.[0] ?? defaultProfileColor(p.handle || p.displayName) }} />
      <div className="pcard-top">
        <div className="pcard-avatar">
          <AccountAvatar profile={p} size={compact ? 80 : 96} />
        </div>
        {actions && <div className="pcard-actions">{actions}</div>}
      </div>
      <div className="pcard-panel">
        <h1 className="pcard-name">{shownName(p)}</h1>
        {p.handle && <div className="pcard-handle">@{p.handle}</div>}
        {(p.bio || p.memberSince) && <div className="pcard-divider" />}
        {p.bio && (
          <section>
            <h4>About me</h4>
            <p className="pcard-bio">{p.bio}</p>
          </section>
        )}
        {p.memberSince ? (
          <section>
            <h4>Member since</h4>
            <p>{memberSince(p.memberSince)}</p>
          </section>
        ) : null}
      </div>
    </div>
  )
}

/** Sidebar → Account: your own card, with Edit profile. */
export function MyProfile() {
  const a = useProjectMAccount()
  if (!a.loggedIn || !a.profile)
    return (
      <ProfileCard
        profile={{
          handle: null,
          displayName: a.loggedIn ? '' : 'Account',
          avatar: null,
          banner: null,
          colors: null,
          bio: a.needsLogin ? 'Logged out on this PC. Log in again to keep syncing.' : a.loggedIn ? '' : 'Not logged in. Log in or create an account below.',
          memberSince: 0,
        }}
      />
    )
  return (
    <ProfileCard
      profile={a.profile}
      actions={
        <>
          {!a.profile.handle && (
            <button className="btn primary small" onClick={() => openAccountDialog('pickHandle')}>
              Pick a username
            </button>
          )}
          <button className="btn small" onClick={() => openAccountDialog('profile')}>
            Edit profile
          </button>
        </>
      }
    />
  )
}

/**
 * The @username box: checks the rules as you type and asks the server whether it's free.
 * `onValid` gets the clean handle when it's usable, null otherwise.
 */
export function HandleField({ value, onChange, onValid, current, autoFocus }: { value: string; onChange: (v: string) => void; onValid: (h: string | null) => void; current?: string | null; autoFocus?: boolean }) {
  const [state, setState] = useState<{ text: string; ok: boolean } | null>(null)
  useEffect(() => {
    const h = cleanHandle(value)
    onValid(null)
    if (!value.trim()) return setState(null)
    if (!h) return setState({ text: HANDLE_RULES, ok: false })
    if (h === current) {
      onValid(h)
      return setState({ text: "That's your username", ok: true })
    }
    setState({ text: 'Checking…', ok: false })
    let live = true
    const t = setTimeout(() => {
      window.api.account.handleAvailable(h).then(
        (r) => {
          if (!live) return
          setState(r.available ? { text: `@${h} is free`, ok: true } : { text: r.reason === 'taken' ? `@${h} is taken` : HANDLE_RULES, ok: false })
          onValid(r.available ? h : null)
        },
        () => live && setState({ text: "Couldn't check right now", ok: false }),
      )
    }, 350)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [value, current])
  return (
    <label className="field">
      <span>Username</span>
      <div className="handle-input">
        <span>@</span>
        <input
          className="text-input plain"
          value={value}
          autoFocus={autoFocus}
          spellCheck={false}
          autoComplete="off"
          maxLength={21}
          onChange={(e) => onChange(e.target.value.replace(/\s/g, '').toLowerCase())}
        />
      </div>
      {state && <small className={cls('field-hint', state.ok ? 'good' : 'bad')}>{state.text}</small>}
    </label>
  )
}

export function DisplayNameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>Display name</span>
      <input className="text-input plain" value={value} maxLength={MAX_DISPLAY_NAME} placeholder="Optional, shown above your @username" onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

/** Profile colours to start from: the app's accent, and a dark shade below. */
const startColors = (): [string, string] => {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  return [/^#[0-9a-f]{6}$/i.test(accent) ? accent.toLowerCase() : '#8b5cf6', '#1e1b2e']
}

/**
 * Edit profile, like Discord's: settings on the left, a live preview of your card on the right.
 * `pick`: an account from before usernames choosing one.
 */
export function EditProfile({ close, pick }: { close: () => void; pick?: boolean }) {
  const a = useProjectMAccount()
  const p = a.profile
  const [handle, setHandle] = useState(p?.handle ?? '')
  const [valid, setValid] = useState<string | null>(p?.handle ?? null)
  const [name, setName] = useState(p?.displayName ?? '')
  const [bio, setBio] = useState(p?.bio ?? '')
  const [colors, setColors] = useState<[string, string] | null>(p?.colors ?? null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const act = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what)
    setError(null)
    try {
      await fn()
      return true
    } catch (e) {
      setError(accountError(e))
      return false
    } finally {
      setBusy(null)
    }
  }
  const patch: { handle?: string; displayName?: string; colors?: [string, string] | null; bio?: string } = {}
  if (valid && valid !== p?.handle) patch.handle = valid
  if (name.trim() !== (p?.displayName ?? '')) patch.displayName = name.trim()
  if (bio.trim() !== (p?.bio ?? '')) patch.bio = bio.trim()
  if (JSON.stringify(colors) !== JSON.stringify(p?.colors ?? null)) patch.colors = colors
  const changed = Object.keys(patch).length > 0
  const save = async () => {
    if (await act('save', () => window.api.account.updateProfile(patch))) {
      toast(pick ? `You're @${valid}` : 'Profile saved')
      close()
    }
  }
  const image = (kind: 'avatar' | 'banner') => {
    const what = kind === 'banner' ? 'banner' : 'photo'
    return (
      <div className="row">
        <button className="btn small" disabled={!!busy} onClick={() => act(kind, async () => (await window.api.account.pickImage(kind)) && toast(`${kind === 'banner' ? 'Banner' : 'Photo'} updated`))}>
          {busy === kind ? 'Uploading…' : p?.[kind] ? `Change ${what}` : `Add ${what}`}
        </button>
        {p?.[kind] && (
          <button className="btn small ghost" disabled={!!busy} onClick={() => act(kind, () => window.api.account.removeImage(kind))}>
            Remove
          </button>
        )}
      </div>
    )
  }
  const preview: ShownProfile = {
    handle: valid ?? p?.handle ?? null,
    displayName: name.trim(),
    avatar: p?.avatar ?? null,
    banner: p?.banner ?? null,
    colors,
    bio: bio.trim(),
    memberSince: p?.memberSince ?? Date.now(),
  }
  return (
    <div className="edit-profile">
      <div className="edit-profile-form">
        <div className="modal-head">
          <h2>{pick ? 'Pick your username' : 'Edit profile'}</h2>
        </div>
        {pick && <p className="account-intro">ProjectM accounts now have an @username. People on ProjectM can find you by it. You can change it later.</p>}
        <div className="account-fields">
          <DisplayNameField value={name} onChange={setName} />
          <HandleField value={handle} onChange={setHandle} onValid={setValid} current={p?.handle} autoFocus={pick} />
          <div className="field">
            <span>Profile photo</span>
            {image('avatar')}
          </div>
          <div className="field">
            <span>Banner</span>
            {image('banner')}
            <small className="field-hint quiet">A wide picture (5:2) across the top. Without one, the banner is your primary colour.</small>
          </div>
          <div className="field">
            <span>Profile colours</span>
            <div className="row">
              {(colors ?? startColors()).map((c, i) => (
                <label key={i} className={cls('color-swatch', !colors && 'off')}>
                  <input
                    type="color"
                    value={c}
                    onChange={(e) => {
                      const next = [...(colors ?? startColors())] as [string, string]
                      next[i] = e.target.value
                      setColors(next)
                    }}
                  />
                  <span style={{ background: c }} />
                  <small>{i === 0 ? 'Primary' : 'Accent'}</small>
                </label>
              ))}
              {colors && (
                <button className="btn small ghost" onClick={() => setColors(null)}>
                  Reset
                </button>
              )}
            </div>
          </div>
          <label className="field">
            <span>
              About me <small className="counter">{MAX_BIO - bio.length}</small>
            </span>
            <textarea className="text-input plain bio-input" value={bio} maxLength={MAX_BIO} rows={3} placeholder="A few words about you or what you listen to" onChange={(e) => setBio(e.target.value)} />
          </label>
        </div>
        {error && <p className="account-error">{error}</p>}
        <div className="modal-foot account-foot">
          <span />
          <div className="row">
            <button className="btn ghost" onClick={close}>
              {pick ? 'Later' : 'Cancel'}
            </button>
            <button className="btn primary" disabled={!!busy || !valid || !changed} onClick={save}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
      <div className="edit-profile-preview">
        <h4>Preview</h4>
        <ProfileCard profile={preview} compact />
      </div>
    </div>
  )
}

// ---------- other people: Search → ProjectM, and their profile page ----------

/** Search → ProjectM: people by @username or name. */
export function PeopleResults({ query }: { query: string }) {
  const a = useProjectMAccount()
  const nav = useNav()
  const [state, setState] = useState<{ loading: boolean; people: ShownProfile[]; error?: string }>({ loading: false, people: [] })
  useEffect(() => {
    if (!query || !a.loggedIn) return setState({ loading: false, people: [] })
    let live = true
    setState((s) => ({ ...s, loading: true, error: undefined }))
    window.api.account.searchPeople(query).then(
      (people) => live && setState({ loading: false, people }),
      (e) => live && setState({ loading: false, people: [], error: accountError(e) }),
    )
    return () => {
      live = false
    }
  }, [query, a.loggedIn])
  if (!a.loggedIn)
    return (
      <Empty icon={<UserIcon size={30} />} title="Log in to find people">
        <p>People on ProjectM can be found by their @username once you have a ProjectM account.</p>
        <button className="btn primary" onClick={() => openAccountDialog('login')}>
          Log in
        </button>
      </Empty>
    )
  if (!query)
    return (
      <Empty icon={<SearchIcon size={30} />} title="Find people on ProjectM">
        <p>Search by @username or name.</p>
      </Empty>
    )
  if (state.error) return <p className="account-error">{state.error}</p>
  if (!state.loading && !state.people.length)
    return (
      <Empty icon={<SearchIcon size={30} />} title={`No one called "${query}"`}>
        <p>Check the spelling of the @username.</p>
      </Empty>
    )
  return (
    <div className="people-list">
      {state.loading && !state.people.length && <div className="settings-hint">Searching…</div>}
      {state.people.map((u) => (
        <button key={u.handle} className="person-row" onClick={() => nav.go({ kind: 'person', handle: u.handle! })}>
          <AccountAvatar profile={u} size={48} />
          <div className="person-text">
            <div className="person-name">{shownName(u)}</div>
            <div className="person-handle">@{u.handle}</div>
          </div>
          {u.handle === a.profile?.handle && <span className="pill">You</span>}
        </button>
      ))}
    </div>
  )
}

/** Someone's profile (from Search → ProjectM). */
export function PersonView({ handle }: { handle: string }) {
  const [p, setP] = useState<ShownProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setP(null)
    setError(null)
    window.api.account.person(handle).then(setP, (e) => setError(accountError(e)))
  }, [handle])
  return (
    <div className="settings person-view">
      {error ? (
        <Empty icon={<UserIcon size={30} />} title={`@${handle}`}>
          <p>{error}</p>
        </Empty>
      ) : p ? (
        <ProfileCard profile={p} />
      ) : (
        <div className="settings-hint">Loading @{handle}…</div>
      )}
    </div>
  )
}
