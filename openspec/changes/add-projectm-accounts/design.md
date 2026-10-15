# Design

## Context

- Both apps already share a playlist merge (`src/shared/sync.ts` in ProjectM, an identical copy at `src/core/sync.ts` in ProjectMobile): newest edit wins per playlist, tombstones for deletions, retries when another device saved at the same time. Today it talks to a private GitHub repo through a GitHub App device login (`src/main/playlist-sync.ts`, `src/lib/sync.ts`).
- ProjectM keeps data in JSON files in its data folder (playlists, settings, `history.json`) and platform sign-ins in `accounts.json` via `Secrets` (Windows DPAPI). ProjectMobile uses `JsonFile` and the iOS keychain (`secrets`). Local songs in playlists already get their own copy (PC: `kept-files.ts`; phone: `playlist-files` folder), and a local song from another device already plays a matching local copy (title + main artist + length within 3 s).
- Platform sign-ins today: YouTube Music is a TV-client OAuth credential (refresh token, not rotated by Google); SoundCloud is a profile id + username; Spotify is PKCE with a user-supplied Client ID and a refresh token that Spotify rotates on use.
- No domain or email service exists, so nothing can depend on sending email.

## Goals / Non-Goals

**Goals:**
- One small server that both apps use, cheap enough for the Cloudflare free tier with a handful of users.
- The server never needs the user's password and cannot read platform sign-ins.
- Reuse the existing merge logic and per-app storage; the sync layer swaps its transport, not its rules.

**Non-Goals:**
- Sharing playlists between different people, public profiles, or social features.
- Syncing per-device things: volume, queue, playback position, offline mode and download-on-mobile-data switches, downloaded songs/offline cache, window layout.
- Permanent cloud storage of music. Local songs are only relayed.
- Spotify sign-in sharing (impossible without signing other devices out).
- An admin website. Accounts are managed through the API and Cloudflare's dashboard.

## Decisions

### 1. Cloudflare Worker + D1 + Workers KV in a new repo
`meloniexyz/projectm-server`, TypeScript Worker deployed with `wrangler`.
- **D1** holds accounts, sessions, devices, sync documents and relay bookkeeping.
- **Workers KV** holds blobs: custom playlist covers and relayed songs.
- R2 was the first choice (10 GB, any file size) but needs a payment card on the account even for its free plan. The owner chose KV, which needs no card. Its limits are 1 GB total, 25 MB per value, and 1,000 writes and 1,000 deletes a day on the free plan, so the relay cap is 250 MB per account and songs over 25 MB are not relayed. Moving to R2 later only changes the server's storage calls.

Alternatives:
- **GitHub per user:** needs a GitHub account, a repo and an app install per person. Rejected: too much for non-developers.
- **Supabase/Firebase:** extra vendor and SDKs in both apps, and the free tiers pause idle projects.
- **A VPS:** needs upkeep.

### 2. Keys from the password (client side)
- On sign-up, the device creates a random 32-byte **account key** (AES-GCM). It encrypts the platform sign-ins.
- **Wrapping the account key:** from the password plus a per-account salt, the device derives `loginKey` and `wrapKey` (PBKDF2-SHA256, 310k iterations, separate labels).
  - `loginKey` is sent to the server, which stores only a salted hash of it.
  - `wrapKey` encrypts the account key; the server stores the encrypted account key.
- **Recovery code** (optional backup): 24 random characters, shown once. It wraps a second copy of the account key and also yields its own `recoveryLoginKey` hash, so a reset can prove possession without the server learning anything.
- **New password from a logged-in device:** no old password needed. The device sends a `keyProof` (HKDF of the account key, stored hashed by the server) instead, so a stolen session token alone can't change the password. It re-wraps the account key, so nothing else is re-encrypted. This is the normal answer to a forgotten password.
- **Owner-allowed reset:** with no device and no code, the owner runs `npm run allow-reset -- <email>` (24 hours, single use). The app then sends a whole new lock with a **new** account key; the server drops the `platforms` document (unreadable now) and signs out every session. Playlists, look, sound and history stay because they aren't encrypted.
- The owner asked to keep recovery codes but found them too easy to lose as the only way back, hence the three paths.

Why: this lets a new device unlock sign-ins with just email + password, and makes a password reset keep the sign-ins (the user asked for "extra protection" without a second password).

Alternative considered: a separate sync password. Rejected as more to remember for the same protection.

Where it runs: WebCrypto in the Worker; on Windows, the pure-JS PBKDF2 from `@noble` (about 0.7 s for 310k rounds). On iPhone, JavaScript PBKDF2 took about 30 s in the simulator, so ProjectMobile plugs in iOS's own CommonCrypto PBKDF2 through its native module (`setPbkdf2`). That takes **70 ms** for 310k rounds (measured in CI, task 1.4). A diagnostics check confirms native and JavaScript give identical keys, so logins match across devices.

### 3. Sessions
- Login returns a random session token. The server stores a hash of it, along with the device id, name, platform and last seen.
- **Storage on the device:** the token and the account key live in DPAPI `Secrets` on Windows and the keychain on iOS.
- **No expiry while used.** A session is revoked on log out, on removal from the device list, or on a password change (all sessions except the one that made the change).
- **Rate limiting:** 10 failed logins per email per 15 minutes, counted in D1.

### 4. Sync documents
One document per kind per account, stored in D1 as JSON with a version number:
- `playlists` (the existing `SyncDoc`)
- `look`
- `sound`
- `history`
- `platforms` (encrypted)

The client:
1. GETs all documents with their versions.
2. Merges with its local data using per-kind rules.
3. PUTs changed documents with `If-Match: <version>`. On 409 it re-reads and merges again; this is the same loop as the current `syncOnce`.

Merge rules per kind:
- **playlists:** existing `mergePlaylists`.
- **look / sound:** last-writer-wins per field, with a changed-at time per field. Unknown fields are kept, which carries iPhone-only options.
- **history:** union by entry id. Deletions and "cleared before T" markers are kept as tombstones. The server keeps the newest 5,000 entries.
- **platforms:** one encrypted blob containing `{ youtube?, soundcloud?, spotifyClientId?, changedAt per item }`, decrypted and merged per item on the device.

Size: a 5,000-entry history is about 2 MB, under D1's row limit. If needed it is split into monthly documents (an internal change).

Alternative considered: one big document. Rejected because history traffic would resend playlists on every play.

### 5. Custom playlist covers
A cover picked from files is uploaded once to KV under `covers/<account>/<hash>` (max 1 MB, re-encoded to JPEG 512 px). The playlist stores a `projectm-cover:<hash>` reference that each device downloads and caches. Covers are permanent while a playlist uses them; a weekly cleanup removes unused ones.

### 6. Local song relay
D1 tables `relay(account, song_key, size, uploaded_by, uploaded_at)` and `relay_needs(account, song_key, device)`, with the file in KV at `relay/<account>/<song_key>`. `song_key` is the normalized title | main artist | rounded length, the same match rule the apps already use.

How it flows:
1. After syncing playlists, each device reports `have` (local songs it has) and `need` (local songs in playlists that it lacks).
2. The server answers with:
   - **downloads:** songs on the server this device needs.
   - **upload requests:** songs this device has that some other device needs, and that aren't on the server.
3. Uploads stop at 250 MB per account in transit, and files over 25 MB are never relayed.
4. **Uploading:** files are sent to the Worker, which stores them in KV (25 MB fits within a request).
5. **Confirming:** after download, the device confirms. When no `relay_needs` row is left for the song, the server deletes the file.
6. **Cleanup:** a daily cron deletes anything older than 30 days.

Edge cases:
- A device removed from the device list is taken out of every `needed_by`.
- Downloads on iPhone follow the "download on mobile data" setting. Delivered files go into the playlist files folder, so they play offline and are treated as "have".

Alternative considered: storing music permanently. Rejected by the user; relaying keeps storage near zero.

### 7. Client structure
- **Shared module** (identical in both apps): `account.ts` (keys, API client, merge per kind), replacing the GitHub transport in `sync.ts`. `mergePlaylists` and the base64 helpers stay.
- **ProjectM:** the main process owns the session and sync, like `playlist-sync.ts` now. The renderer gets `api.account.*` (signUp, logIn, logOut, status, devices, changePassword, recover) and a status event.
- **ProjectMobile:** `src/lib/account.ts` with the same API surface.

Screens:
- Settings → **Account**: email, status, devices, change password, log out.
- A first-run "Log in or create account" sheet, which can be skipped.
- The GitHub "Playlist sync" section is removed.

### 8. Stages
- **Stage 1** (ProjectM 1.1.0 / ProjectMobile 1.4.0): server, accounts, sessions, devices, recovery code, playlists + covers, migration off GitHub sync.
- **Stage 2** (ProjectM 1.2.0 / ProjectMobile 1.5.0): look, sound, history, platform sign-ins, local song relay.

## Risks / Trade-offs

- [The owner holds other people's data] → Data is minimal, sign-ins are encrypted on the device, and there's no music storage beyond 30 days. The README states what is stored.
- [PBKDF2 is slow in Hermes on older iPhones] → The iteration count is measured in task 1.4 and stored per account, so it can be lowered for new accounts without breaking old ones.
- [Lost password and lost recovery code means the account is gone] → Plain warning at sign-up. Playlists still exist on the devices and can be moved into a new account by logging in there.
- [Free-tier limits: KV 1 GB and 1,000 writes a day, D1 5 GB, 100k Worker requests a day] → The relay cap is 250 MB per account; covers are written once. Sync runs at most every 2 minutes per open device (about 700 requests a device a day). Fine for a small group of friends.
- [A YouTube refresh token shared across devices gets revoked] → Each device detects "signed out" and clears it account-wide, so the person reconnects once.
- [A stolen session token] → It's stored in DPAPI / the keychain, can be revoked from the devices list, and can't decrypt sign-ins without the account key (also stored only on devices).
- [Clock differences break last-writer-wins] → The server stamps `changedAt` on receipt for look/sound fields; playlists keep their own `updatedAt`, as now.

## Migration Plan

1. Deploy the server (`wrangler deploy`, D1 migrations, KV namespace, cron). Smoke-test the API with a script.
2. Release stage 1 of both apps.
   - On first login, the device merges its playlists into the account and turns GitHub sync off. Its GitHub token is deleted from the device; the repo is untouched.
   - Devices that don't log in keep working offline, with GitHub sync still on until they update.
3. Release stage 2 of both apps.
4. **Rollback:** each stage is a normal app release, and the previous version still works with the data on the device. The server can stay up; old apps ignore it.

## Open Questions

- The account limit for the server (for example, closed sign-up with an invite code) can be added later without changing the apps' flow.
