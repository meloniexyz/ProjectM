// ProjectM account keys. Shared by ProjectM (Windows) and ProjectMobile (iOS): keep every copy identical.
//
// The password never leaves the device. PBKDF2 turns it into a master secret, and HKDF splits that
// into a login key (sent to the server, which hashes it again) and a wrap key (stays on the device).
// A random account key encrypts private data (platform sign-ins); the server only keeps it wrapped:
// once with the password's wrap key and once with the recovery code's. A key proof derived from it
// lets a logged-in device set a new password without the old one.
// Pure JS (@noble) so it behaves the same in Electron, Node and Hermes on iPhone.
import { gcm } from '@noble/ciphers/aes.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js'
import { sha256 } from '@noble/hashes/sha2.js'

/** PBKDF2 rounds for new accounts; each account stores its own count, so this can change later. */
export const DEFAULT_ITERATIONS = 310_000

const enc = new TextEncoder()
const dec = new TextDecoder()

export const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n))

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
export function toB64(bytes: Uint8Array) {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=')
  }
  return out
}
export function fromB64(b64: string) {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let j = 0
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((B64.indexOf(clean[i + 2]) & 63) << 6) | (B64.indexOf(clean[i + 3]) & 63)
    out[j++] = (n >> 16) & 255
    if (clean[i + 2] !== undefined) out[j++] = (n >> 8) & 255
    if (clean[i + 3] !== undefined) out[j++] = n & 255
  }
  return out.subarray(0, j)
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase()
const normalizeSecret = (s: string) => s.normalize('NFKC')
/** recovery codes are typed by hand: ignore case, spaces and dashes */
const normalizeCode = (code: string) => code.toUpperCase().replace(/[^0-9A-Z]/g, '')

export interface DerivedKeys {
  /** sent to the server to prove the password (the server hashes it again) */
  loginKey: string
  /** never leaves the device: unwraps the account key */
  wrapKey: Uint8Array
}

type Pbkdf2 = (password: Uint8Array, salt: Uint8Array, iterations: number, length: number) => Promise<Uint8Array>
let pbkdf2: Pbkdf2 = (password, salt, c, dkLen) => pbkdf2Async(sha256, password, salt, { c, dkLen, asyncTick: 20 })
/** ProjectMobile passes iOS's native PBKDF2-HMAC-SHA256 (same result, ~50x faster than JavaScript there). */
export const setPbkdf2 = (fn: Pbkdf2) => (pbkdf2 = fn)

/** Password (or recovery code) + salt -> login key and wrap key. Takes about a second. */
export async function deriveKeys(secret: string, saltB64: string, iterations: number): Promise<DerivedKeys> {
  const master = await pbkdf2(enc.encode(secret), fromB64(saltB64), iterations, 32)
  return {
    loginKey: toB64(hkdf(sha256, master, undefined, enc.encode('projectm login'), 32)),
    wrapKey: hkdf(sha256, master, undefined, enc.encode('projectm wrap'), 32),
  }
}

/** AES-256-GCM; output is base64(nonce + ciphertext). */
export function seal(key: Uint8Array, data: Uint8Array) {
  const nonce = randomBytes(12)
  const ct = gcm(key, nonce).encrypt(data)
  const out = new Uint8Array(12 + ct.length)
  out.set(nonce)
  out.set(ct, 12)
  return toB64(out)
}

/** Throws if the key is wrong or the data was changed. */
export function open(key: Uint8Array, sealed: string) {
  const raw = fromB64(sealed)
  return gcm(key, raw.subarray(0, 12)).decrypt(raw.subarray(12))
}

export const sealJson = (key: Uint8Array, value: unknown) => seal(key, enc.encode(JSON.stringify(value)))
export const openJson = <T>(key: Uint8Array, sealed: string): T => JSON.parse(dec.decode(open(key, sealed))) as T

/** 24 characters (about 120 bits), shown as XXXX-XXXX-XXXX-XXXX-XXXX-XXXX. No 0/O or 1/I. */
export function newRecoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(24)
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('')
  return chars.match(/.{4}/g)!.join('-')
}

/** Everything the server keeps about how to unlock an account (nothing here reveals the password). */
export interface AccountLock {
  salt: string
  iterations: number
  loginKey: string
  wrappedKey: string
  recoverySalt: string
  recoveryLoginKey: string
  recoveryWrappedKey: string
  /** proves a device holds the account key (lets a logged-in device set a new password) */
  keyProof: string
}

/** Only a device with the account key can compute this; the server keeps a hash of it. */
export const keyProof = (accountKey: Uint8Array) => toB64(hkdf(sha256, accountKey, undefined, enc.encode('projectm key proof'), 32))

/** A new account: random account key, locked by the password and by a fresh recovery code. */
export async function newAccountLock(password: string, iterations = DEFAULT_ITERATIONS) {
  const accountKey = randomBytes(32)
  const recoveryCode = newRecoveryCode()
  const lock = await lockAccountKey(accountKey, password, recoveryCode, iterations)
  return { accountKey, recoveryCode, lock }
}

/** Locks an existing account key with a (new) password and recovery code. */
export async function lockAccountKey(accountKey: Uint8Array, password: string, recoveryCode: string, iterations = DEFAULT_ITERATIONS): Promise<AccountLock> {
  const salt = toB64(randomBytes(16))
  const recoverySalt = toB64(randomBytes(16))
  const [pw, rc] = await Promise.all([
    deriveKeys(normalizeSecret(password), salt, iterations),
    deriveKeys(normalizeCode(recoveryCode), recoverySalt, iterations),
  ])
  return {
    salt,
    iterations,
    loginKey: pw.loginKey,
    wrappedKey: seal(pw.wrapKey, accountKey),
    recoverySalt,
    recoveryLoginKey: rc.loginKey,
    recoveryWrappedKey: seal(rc.wrapKey, accountKey),
    keyProof: keyProof(accountKey),
  }
}

/** Password -> keys, using the salt the server gave for this email. */
export const passwordKeys = (password: string, salt: string, iterations: number) => deriveKeys(normalizeSecret(password), salt, iterations)
export const recoveryKeys = (code: string, salt: string, iterations: number) => deriveKeys(normalizeCode(code), salt, iterations)

/** Unwraps the account key; throws if the password/code is wrong. */
export const unwrapAccountKey = (wrapKey: Uint8Array, wrapped: string) => open(wrapKey, wrapped)
