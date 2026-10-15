# Spec Delta

## Purpose

Lets local songs in synced playlists play on every device of an account, by passing the files between devices through the server and deleting them once they have arrived.

## ADDED Requirements

### Requirement: Local songs are offered to other devices
When a local song is in a synced playlist, the device that has the file SHALL upload it to the server unless every device of the account already has the song (including a matching song with the same title, main artist and length within 3 seconds).

#### Scenario: Song added on the PC
- **WHEN** a local song from the PC is added to a playlist, and the account also has a phone
- **THEN** the PC uploads it, and the phone downloads it and can play it, also offline

#### Scenario: Phone already has the song
- **WHEN** the phone already has a matching local song
- **THEN** nothing is uploaded and the phone plays its own copy

### Requirement: Delete once delivered
The server SHALL delete an uploaded song as soon as every device of the account that needs it has downloaded it.

#### Scenario: Two devices
- **WHEN** the PC uploads a song and the account's only other device, the phone, downloads it
- **THEN** the song is deleted from the server

#### Scenario: Three devices
- **WHEN** one of two other devices has downloaded the song
- **THEN** the song stays on the server until the second one has downloaded it too

### Requirement: Devices added later
A device that logs in later SHALL ask for the local songs it is missing. A device that has a song SHALL upload it again the next time it is online, and it SHALL then be deleted once delivered.

#### Scenario: New phone, PC offline
- **WHEN** a new phone logs in while the PC that has the songs is off
- **THEN** the songs show as "waiting for another device", and arrive after the PC is next opened

### Requirement: Unclaimed songs expire
A song SHALL be deleted from the server 30 days after upload even if some device has not collected it. That device SHALL ask for it again when it next needs it.

#### Scenario: Device not opened for a month
- **WHEN** a song has waited 30 days for a device that was never opened
- **THEN** the server deletes it, and that device asks for it again when it next syncs

### Requirement: Limit per account
Each account SHALL have at most 250 MB of songs on the server at a time. Uploads beyond that SHALL wait until space frees up, without failing playlist sync.

#### Scenario: Big playlist
- **WHEN** a person adds 2 GB of local songs to a synced playlist
- **THEN** about 250 MB is uploaded, the rest uploads as devices collect and the server deletes earlier songs, and the app shows how many songs are still waiting

### Requirement: Songs too big to pass on
A local song file over 25 MB SHALL not be relayed. It SHALL stay in the playlist on every device and play where the file is; other devices SHALL show it as "too big to transfer".

#### Scenario: Large FLAC
- **WHEN** a 40 MB FLAC song is in a synced playlist
- **THEN** it is not uploaded, and the phone shows it greyed out as "too big to transfer" unless it has its own matching copy

### Requirement: Downloads respect data settings
On iPhone, downloading relayed songs SHALL follow the "download on mobile data" setting, and the app SHALL show relay progress in Settings → Account.

#### Scenario: On mobile data
- **WHEN** the phone is on mobile data and downloading on mobile data is off
- **THEN** relayed songs wait until Wi-Fi
