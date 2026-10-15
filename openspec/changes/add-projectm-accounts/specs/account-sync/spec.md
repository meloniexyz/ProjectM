# Spec Delta

## Purpose

Keeps a person's ProjectM playlists, look, sound settings and listening history the same on every PC and iPhone logged in to their account.

## ADDED Requirements

### Requirement: Playlists follow the account
Every ProjectM playlist (name, description, songs in order, cover from a service, created and changed times) SHALL be kept the same on all devices of the account, including songs from Spotify, YouTube Music, SoundCloud and local files.

#### Scenario: Playlist made on the PC
- **WHEN** a person creates a playlist on the PC and opens ProjectMobile on their phone
- **THEN** the playlist is on the phone with the same songs in the same order

#### Scenario: Custom cover picked from files
- **WHEN** a playlist uses a cover picture chosen from the device's own files
- **THEN** other devices show the cover too

### Requirement: Merging edits from several devices
Playlists SHALL be merged per playlist: the most recently changed version of a playlist wins, a deletion wins over changes made before it, and a change made after a deletion brings the playlist back. Different playlists changed on different devices SHALL all keep their changes.

#### Scenario: Two playlists, two devices
- **WHEN** "Gym" is edited on the phone and "Chill" on the PC while both are offline, and both come online
- **THEN** both edits are kept on both devices

#### Scenario: Same playlist on two devices
- **WHEN** the same playlist is edited on two devices
- **THEN** both devices end up with the version that was changed last

#### Scenario: Deleted on one device
- **WHEN** a playlist is deleted on the phone
- **THEN** it is deleted on every other device of the account

### Requirement: Look follows the account
Theme, accent colour, logo style and interface style (classic / Feishin / Liquid Glass) SHALL follow the account. A look option that a platform does not have SHALL be kept for the devices that have it and ignored on the others.

#### Scenario: Accent change
- **WHEN** the accent colour is changed on the PC
- **THEN** the phone uses the same accent colour (and the matching app icon) after its next sync

#### Scenario: iPhone-only option
- **WHEN** Liquid Glass is turned on on the phone
- **THEN** the PC keeps its own interface and the setting is kept for the person's other iPhones

### Requirement: Sound follows the account
Equalizer (on/off, bands, gains, preset, custom presets), loudness level, volume leveling and audio quality (Wi-Fi, mobile data and download quality on iPhone) SHALL follow the account. Volume, playback position, queue and the offline/download-on-mobile-data switches SHALL stay per device.

#### Scenario: Custom EQ preset
- **WHEN** a person saves a custom EQ preset on the phone
- **THEN** it appears in the PC's equalizer presets

#### Scenario: Audio quality on a second phone
- **WHEN** a person sets Wi-Fi quality to Best and mobile data to Low on one iPhone
- **THEN** their other iPhones use the same qualities after the next sync, and the PC keeps the values for them (the PC always streams at the highest quality)

### Requirement: Listening history follows the account
Plays from every device SHALL be combined into one history, shown on every device's History page and used for "Jump back in" and "Most played". Removing an entry or clearing history SHALL apply on every device.

#### Scenario: Play on the phone, see on the PC
- **WHEN** a song is played on the phone
- **THEN** it appears in the PC's history after the next sync, with the time it was played

#### Scenario: Clear history
- **WHEN** a person clears their history on the PC
- **THEN** the history is empty on all their devices

### Requirement: When syncing happens
A logged-in device SHALL sync within 5 seconds of a change on it, when the app is opened or brought to the front, and at least every 2 minutes while open. Changes made offline SHALL be kept on the device and synced when it is back online. Syncing SHALL never delay playback or skipping.

#### Scenario: Offline edit
- **WHEN** a playlist is edited on the phone in airplane mode and the phone later goes online
- **THEN** the edit reaches the account and the other devices

#### Scenario: Status
- **WHEN** the person opens Settings → Account
- **THEN** it shows the account email, whether it is syncing, when it last synced, and any error in plain words

### Requirement: First login moves existing data in
On a device's first login, its existing ProjectM playlists, look, sound settings and history SHALL be merged into the account rather than replaced. Devices using the earlier GitHub playlist sync SHALL stop using it after login.

#### Scenario: PC with playlists logs in to a new account
- **WHEN** a PC that already has playlists and history logs in to a brand new account
- **THEN** those playlists and that history become the account's

#### Scenario: Second device with its own playlists
- **WHEN** a phone with its own playlists logs in to an account that already has the PC's playlists
- **THEN** the account has both sets; nothing is lost

#### Scenario: GitHub sync was on
- **WHEN** a device that used GitHub playlist sync logs in
- **THEN** GitHub sync turns off on that device, its playlists move to the account, and the GitHub repo is left untouched
