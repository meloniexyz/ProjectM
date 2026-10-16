# Tasks

## 1. Server foundation (stage 1)

- [x] 1.1 Create the repo `meloniexyz/projectm-server` (Worker in TypeScript, wrangler config, D1 database, KV namespace, daily cron) and verify `wrangler deploy` succeeds after the owner's one-time `wrangler login`
- [x] 1.2 Write the D1 migrations (accounts, sessions, devices, login_attempts, documents, covers, relay) and verify `wrangler d1 migrations apply` runs on a fresh local database and the deployed one
- [x] 1.3 Write the shared key module (account key, PBKDF2 login/wrap keys, AES-GCM wrap/unwrap, recovery code) and verify unit tests: a wrapped key unwraps with the right password and recovery code, and fails with wrong ones
- [x] 1.4 Measure PBKDF2 and AES-GCM speed under Hermes in the iOS simulator in CI (diagnostics check) and verify 310k iterations take under 1.5 s or record the chosen count; document it in design.md
- [x] 1.5 Implement sign-up, log-in (with the same message for a wrong email or password, plus a 10-in-15-minutes limit), log-out, session check, device list and device removal, and verify with an API test script against the local Worker covering every account-sign-in scenario
- [x] 1.6 Implement new password from a logged-in device (key proof, no old password), recovery-code reset, and owner-allowed reset (`npm run allow-reset`), each re-wrapping or replacing the account key and revoking other sessions; verify with the API test script that data survives all three and platform sign-ins survive the first two
- [x] 1.7 Implement document GET/PUT with versions (409 on conflict) and verify with the API test that two clients writing at once both converge
- [x] 1.8 Implement custom cover upload/download (1 MB max, account-scoped, weekly cleanup of unused covers) and verify the test uploads, fetches and cleans up a cover
- [x] 1.9 Write the server README (what is stored, costs, deploy steps, how to delete an account) and verify the deploy steps work from a clean clone

## 2. ProjectM (Windows) accounts + playlists (stage 1)

- [x] 2.1 Add the account client to `src/shared` (API calls, keys, document sync loop reusing `mergePlaylists`) and verify unit tests for playlist merge through the new transport
- [x] 2.2 Replace `src/main/playlist-sync.ts` with an account sync service (session and account key in DPAPI `Secrets`, sync on change, focus and every 2 minutes, retry on dropped connections) and verify in the dev app with test data that a playlist edit reaches the server within 5 s
- [x] 2.3 Add Settings → Account (sign up, log in, recovery code screen, status, devices, change password, recover, log out) and a skippable first-run sheet, and verify each account-sign-in scenario by hand in the dev app with screenshots
- [x] 2.4 Sync custom covers picked from files (upload once, `projectm-cover:` reference, download and cache on other devices) and verify a cover set in one test profile shows in a second one
- [x] 2.5 Migrate off GitHub sync on first login (merge local playlists into the account, delete the GitHub token, remove the Playlist sync section) and verify with a test profile that had GitHub sync on

## 3. ProjectMobile (iOS) accounts + playlists (stage 1)

- [x] 3.1 Copy the shared account client to `src/core` (identical file) and verify `npx tsc --noEmit` and the iOS bundle build
- [x] 3.2 Replace `src/lib/sync.ts` with account sync (session and account key in the keychain, sync on change, app foreground and every 2 minutes) and verify a diagnostics check that signs up a throwaway account in CI, syncs a playlist and deletes the account
- [x] 3.3 Add Settings → Account and the first-run sheet, mirroring the PC, and verify with Maestro e2e steps (open Account, sign-up form validation) and screenshots
- [x] 3.4 Sync custom covers and migrate off GitHub sync, as on PC, and verify with the diagnostics check above extended to a cover
- [x] 3.5 Cross-device check: log the PC dev app and the iPhone simulator into the same test account, edit playlists on both, and verify both end with the same playlists

## 4. Stage 1 release

- [x] 4.1 Release ProjectM 1.1.0 and ProjectMobile 1.4.0 (version bumps, release notes, GitHub releases) and verify both releases have their installers and the iOS CI is green

## 5. Look, sound and history sync (stage 2)

- [x] 5.1 Add `look` and `sound` documents with per-field last-writer-wins (server-stamped times; unknown fields kept) in the shared client and verify merge unit tests, including an iPhone-only field kept by the PC
- [x] 5.2 Wire look/sound into both apps' settings stores (synced: theme, accent, logo, style, EQ, loudness, leveling, Wi-Fi/mobile/download quality; volume and offline switches stay per device) and verify an accent, EQ preset and quality change cross between the PC dev app and the simulator
- [x] 5.3 Add the `history` document (union by entry id, removal and clear markers, newest 5,000 kept) and wire both apps' history stores, and verify a play on one device appears on the other and clearing empties both

## 6. Platform sign-ins (stage 2)

- [x] 6.1 Add the encrypted `platforms` document (YouTube Music OAuth, SoundCloud profile, Spotify Client ID; per-item changedAt) and verify a unit test that the server copy is unreadable without the account key
- [x] 6.2 Hook YouTube Music and SoundCloud connect/disconnect on both apps into the document (apply incoming sign-ins, clear account-wide on "signed out"), and verify connecting on the PC dev app makes the simulator show YouTube Music connected
- [x] 6.3 Prefill the Spotify Client ID on other devices and show "Tap to connect", and verify Settings shows it on the second device
- [x] 6.4 Remove account-delivered sign-ins on log out, and verify the second device shows the platforms disconnected after logging out

## 7. Local song relay (stage 2)

- [x] 7.1 Server: relay table, have/need report endpoint, upload/download through the Worker to KV, delivery confirmation with delete, 250 MB cap, 25 MB per file, 30-day cron, device removal clean-up; verify with the API test script covering each local-file-relay scenario
- [x] 7.2 ProjectM: report have/need after playlist sync, upload requested songs from the kept copies, download needed songs into the playlist files folder, and show relay progress in Settings → Account; verify between two test profiles that a local song moves across and is deleted from the server after
- [x] 7.3 ProjectMobile: the same, following "download on mobile data", and verify the simulator receives a song uploaded by the PC dev app and plays it offline
- [x] 7.4 Verify the "device added later" path: a third test profile logs in after delivery, gets "waiting for another device", and receives the song once a device that has it comes online

## 8. Stage 2 release

- [x] 8.1 Cross-device check of everything in stage 2 between the PC dev app and the simulator, and verify every scenario in the four specs is covered by a passing test or a recorded manual check
- [x] 8.2 Release ProjectM 1.2.0 and ProjectMobile 1.5.0 and verify both releases and the iOS CI

## Workflow follow-up

- Archive the change after both stages are released and the owner has confirmed it works on their own devices.
