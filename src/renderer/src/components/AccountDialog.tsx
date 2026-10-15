import { useEffect, useState, type ReactNode } from 'react'
import { accountDialogStore, accountError, accountPromptDone, closeAccountDialog, openAccountDialog, type AccountDialogMode } from '../lib/account'
import { useStore } from '../lib/store'
import { toast } from '../lib/ui'
import { XIcon } from './Icons'

/** Log in, create an account, reset with the recovery code, change password, delete the account. */
export function AccountDialogHost() {
  const mode = useStore(accountDialogStore, (s) => s.mode)
  if (!mode) return null
  return <AccountDialog key={typeof mode === 'string' ? mode : 'code'} mode={mode} />
}

function AccountDialog({ mode }: { mode: AccountDialogMode }) {
  const close = () => {
    // the recovery code can't be dismissed by accident
    if (typeof mode !== 'string') return
    accountPromptDone() // the first-launch prompt counts as answered ("not now")
    closeAccountDialog()
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal account-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog">
        {typeof mode !== 'string' ? (
          <RecoveryCode code={mode.recoveryCode} />
        ) : mode === 'login' ? (
          <LogIn close={close} />
        ) : mode === 'signup' ? (
          <SignUp close={close} />
        ) : mode === 'recover' ? (
          <Recover close={close} />
        ) : mode === 'password' ? (
          <ChangePassword close={close} />
        ) : (
          <DeleteAccount close={close} />
        )}
      </div>
    </div>
  )
}

function Head({ title, close }: { title: string; close?: () => void }) {
  return (
    <div className="modal-head">
      <h2>{title}</h2>
      {close && (
        <button className="icon-btn" title="Close" onClick={close}>
          <XIcon size={18} />
        </button>
      )}
    </div>
  )
}

function Field({ label, type = 'text', value, onChange, autoFocus, hint, onEnter }: { label: string; type?: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; hint?: string; onEnter?: () => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        className="text-input plain"
        type={type}
        value={value}
        autoFocus={autoFocus}
        autoComplete={type === 'password' ? 'current-password' : type === 'email' ? 'email' : 'off'}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
      />
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  )
}

/** Runs an account action with a busy state and a plain error message. */
function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(accountError(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

function Foot({ error, children }: { error: string | null; children: ReactNode }) {
  return (
    <>
      {error && <p className="account-error">{error}</p>}
      <div className="modal-foot account-foot">{children}</div>
    </>
  )
}

function LogIn({ close }: { close: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { busy, error, run } = useAction()
  const go = () =>
    run(async () => {
      await window.api.account.logIn(email, password)
      accountPromptDone()
      closeAccountDialog()
      toast('Logged in. Your playlists are syncing.')
    })
  return (
    <>
      <Head title="Log in to ProjectM" close={close} />
      <div className="account-fields">
        <Field label="Email" type="email" value={email} onChange={setEmail} autoFocus onEnter={go} />
        <Field label="Password" type="password" value={password} onChange={setPassword} onEnter={go} />
      </div>
      <Foot error={error}>
        <div className="account-links">
          <button className="link" onClick={() => openAccountDialog('signup')}>
            Create an account
          </button>
          <button className="link" onClick={() => openAccountDialog('recover')}>
            Forgot password?
          </button>
        </div>
        <button className="btn primary" disabled={busy || !email || !password} onClick={go}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </Foot>
    </>
  )
}

function SignUp({ close }: { close: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const { busy, error, run } = useAction()
  const short = password.length > 0 && password.length < 8
  const mismatch = again.length > 0 && again !== password
  const go = () =>
    run(async () => {
      if (password.length < 8) throw new Error('The password needs at least 8 characters')
      if (password !== again) throw new Error("The passwords don't match")
      const { recoveryCode } = await window.api.account.signUp(email, password)
      accountPromptDone()
      openAccountDialog({ recoveryCode })
    })
  return (
    <>
      <Head title="Create a ProjectM account" close={close} />
      <p className="account-intro">Your playlists, look, sound settings, history and music platforms follow you to every PC and iPhone you log in on. Your password never leaves this PC.</p>
      <div className="account-fields">
        <Field label="Email" type="email" value={email} onChange={setEmail} autoFocus onEnter={go} />
        <Field label="Password" type="password" value={password} onChange={setPassword} hint={short ? 'At least 8 characters' : undefined} onEnter={go} />
        <Field label="Password again" type="password" value={again} onChange={setAgain} hint={mismatch ? "Doesn't match" : undefined} onEnter={go} />
      </div>
      <Foot error={error}>
        <button className="link" onClick={() => openAccountDialog('login')}>
          I already have an account
        </button>
        <button className="btn primary" disabled={busy || !email || password.length < 8 || password !== again} onClick={go}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </Foot>
    </>
  )
}

/** Shown once after sign-up or a reset: an extra way back in, worth keeping but not required. */
function RecoveryCode({ code }: { code: string }) {
  return (
    <>
      <Head title="Your recovery code" />
      <p className="account-intro">
        Forgot your password? You can set a new one from any device where you're still logged in. This code is a backup for when you aren't logged in anywhere, and it keeps your connected platforms too. Copy it somewhere safe if you like.
      </p>
      <div className="recovery-code">
        <code>{code}</code>
        <button className="btn small" onClick={() => navigator.clipboard.writeText(code).then(() => toast('Recovery code copied'))}>
          Copy
        </button>
      </div>
      <Foot error={null}>
        <span />
        <button className="btn primary" onClick={closeAccountDialog}>
          Done
        </button>
      </Foot>
    </>
  )
}

function Recover({ close }: { close: () => void }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [notAllowed, setNotAllowed] = useState(false)
  const { busy, error, run } = useAction()
  const go = () =>
    run(async () => {
      if (password.length < 8) throw new Error('The new password needs at least 8 characters')
      setNotAllowed(false)
      try {
        const { recoveryCode } = code.trim() ? await window.api.account.recover(email, code, password) : await window.api.account.ownerReset(email, password)
        accountPromptDone()
        openAccountDialog({ recoveryCode })
      } catch (e) {
        if (/has not been allowed/.test(accountError(e))) setNotAllowed(true)
        else throw e
      }
    })
  return (
    <>
      <Head title="Forgot password" close={close} />
      <p className="account-intro">
        <b>Still logged in on your phone or another PC?</b> Open ProjectM there and choose Settings → Account → Set new password. Nothing to type here.
      </p>
      <p className="account-intro">Not logged in anywhere? Set a new password here with your recovery code, or without it once the person who runs your ProjectM server has allowed a reset.</p>
      <div className="account-fields">
        <Field label="Email" type="email" value={email} onChange={setEmail} autoFocus onEnter={go} />
        <Field label="Recovery code (if you have it)" value={code} onChange={setCode} onEnter={go} />
        <Field label="New password" type="password" value={password} onChange={setPassword} hint={password && password.length < 8 ? 'At least 8 characters' : undefined} onEnter={go} />
      </div>
      {notAllowed && (
        <p className="account-error">
          No reset has been allowed for this email yet. Ask the person who runs your ProjectM server to allow one (it lasts 24 hours), then try again. Without the recovery code, YouTube Music and SoundCloud will need connecting again; everything else stays.
        </p>
      )}
      <Foot error={error}>
        <span className="hint">{code.trim() ? 'Keeps everything, including connected platforms.' : ''}</span>
        <button className="btn primary" disabled={busy || !email || password.length < 8} onClick={go}>
          {busy ? 'Checking…' : 'Set new password'}
        </button>
      </Foot>
    </>
  )
}

/** From a logged-in PC: no old password needed, so a forgotten one can be replaced right here. */
function ChangePassword({ close }: { close: () => void }) {
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const { busy, error, run } = useAction()
  const go = () =>
    run(async () => {
      if (next.length < 8) throw new Error('The new password needs at least 8 characters')
      if (next !== again) throw new Error("The passwords don't match")
      await window.api.account.changePassword(next)
      closeAccountDialog()
      toast('New password set. Your other devices will ask for it.')
    })
  return (
    <>
      <Head title="Set new password" close={close} />
      <p className="account-intro">Works even if you forgot the old one, because this PC is logged in. Your other devices will ask for the new password; nothing is lost.</p>
      <div className="account-fields">
        <Field label="New password" type="password" value={next} onChange={setNext} autoFocus hint={next && next.length < 8 ? 'At least 8 characters' : undefined} onEnter={go} />
        <Field label="New password again" type="password" value={again} onChange={setAgain} hint={again && again !== next ? "Doesn't match" : undefined} onEnter={go} />
      </div>
      <Foot error={error}>
        <span className="hint">Your recovery code keeps working.</span>
        <button className="btn primary" disabled={busy || next.length < 8 || next !== again} onClick={go}>
          {busy ? 'Saving…' : 'Set new password'}
        </button>
      </Foot>
    </>
  )
}

function DeleteAccount({ close }: { close: () => void }) {
  const [password, setPassword] = useState('')
  const { busy, error, run } = useAction()
  const go = () =>
    run(async () => {
      await window.api.account.deleteAccount(password)
      closeAccountDialog()
      toast('Account deleted. Your playlists stay on this PC.')
    })
  return (
    <>
      <Head title="Delete account" close={close} />
      <p className="account-intro">This deletes your ProjectM account and everything stored with it, and logs out all your devices. Playlists, settings and history already on your devices stay there.</p>
      <div className="account-fields">
        <Field label="Password" type="password" value={password} onChange={setPassword} autoFocus onEnter={go} />
      </div>
      <Foot error={error}>
        <span />
        <button className="btn danger" disabled={busy || !password} onClick={go}>
          {busy ? 'Deleting…' : 'Delete account'}
        </button>
      </Foot>
    </>
  )
}
