# Proposal

## Why

Today a fresh ProjectM install on a new PC or phone starts empty: playlists only follow you if you set up the GitHub-based playlist sync (which needs a GitHub account, a private repo and an installed GitHub App per person), and every platform, setting and your history have to be set up again. The owner wants friends to use ProjectM too, so the app needs real accounts anyone can create, with everything they care about following them to any device.

## What Changes

- **ProjectM accounts** on a small Cloudflare server (Worker + D1 database + Workers KV storage), in a new server repo. Sign up / log in with email and password from ProjectM (Windows) and ProjectMobile (iOS); one account per person, any number of devices.
- **Password never leaves the device as typed**: it is turned into a login key (sent to the server) and a separate encryption key (kept on the device). Platform sign-ins are encrypted on the device with that key, so the server only stores scrambled data.
- **What follows the account**: ProjectM playlists, look (theme, accent, logo, Feishin / Liquid Glass style), sound (equalizer, loudness level, volume leveling, audio quality), listening history, YouTube Music and SoundCloud sign-ins, and the Spotify Client ID (Spotify itself needs one "Connect" tap per device because its sign-in keys change on every use).
- **Local songs travel too, without being stored**: a local song in a synced playlist is uploaded by the device that has it, kept on the server only until every device on the account has downloaded it, then deleted. A device added later asks for missing songs and a device that has them uploads again when online. Unclaimed songs are deleted after 30 days; each account can have at most 250 MB in transit, and song files over 25 MB are not passed on.
- **BREAKING**: the GitHub playlist sync (ProjectM 1.0.12+, ProjectMobile 1.3.0+) is replaced. On first login, the playlists already on the device are uploaded to the account; the GitHub repo is left untouched and can be deleted by the owner.
- Shipped in two stages, each a release of both apps:
  1. Accounts + playlists (replaces GitHub sync).
  2. Platform sign-ins, look/sound settings, listening history, local song relay.

## Capabilities

### New Capabilities
- `account-sign-in`: creating an account, logging in and out, staying logged in, password change and reset, and how the password is turned into separate login and encryption keys.
- `account-sync`: what follows the account between devices (playlists, look, sound, listening history), when it syncs, how edits from several devices are merged, and the one-time move from GitHub sync.
- `platform-sign-in-sync`: carrying YouTube Music and SoundCloud sign-ins and the Spotify Client ID to new devices, encrypted on the device.
- `local-file-relay`: passing local songs between an account's devices through the server, deleting them once delivered, re-uploading for devices added later, expiry and the per-account limit.

### Modified Capabilities
(none - no specs exist yet in `openspec/specs/`)

## Impact

- **New repo** `meloniexyz/projectm-server`: Cloudflare Worker (TypeScript), D1 schema, Workers KV namespace, deployed with `wrangler`. Needs the owner's free Cloudflare account and a one-time `wrangler login`.
- **ProjectM (Windows)**: new account screen and Settings section; replaces `src/main/playlist-sync.ts` and the GitHub parts of `src/shared/sync.ts` (the merge logic is kept); history (`src/main/history.ts`), settings and platform sign-in storage (`src/main/secrets.ts`, YouTube / SoundCloud / Spotify sources) gain upload/download hooks; local song relay builds on `src/main/kept-files.ts`.
- **ProjectMobile (iOS)**, separate repo `meloniexyz/ProjectMobile`: same changes in `src/lib/sync.ts`, `src/core/sync.ts`, `src/lib/history.ts`, `src/lib/settings.ts`, `src/lib/accounts.ts` and sources, `src/lib/library.ts` (playlist-files folder). The plan is kept here in ProjectM and applies to both apps (feature parity).
- **Costs**: none. Everything fits the Cloudflare free plan without a payment card (KV: 1 GB storage, 1,000 writes a day, 25 MB per file).
- **Responsibility**: the owner holds other people's account data (playlists, history, encrypted sign-ins, songs in transit).
