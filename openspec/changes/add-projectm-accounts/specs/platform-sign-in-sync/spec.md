# Spec Delta

## Purpose

Brings a person's music platform connections to every device of their account, so a new PC or phone is ready to play without signing in to each service again.

## ADDED Requirements

### Requirement: YouTube Music sign-in follows the account
When YouTube Music is connected on one device, every other device of the account SHALL become connected to the same YouTube account without signing in again. Disconnecting on one device SHALL disconnect it everywhere.

#### Scenario: New phone
- **WHEN** a person logs in to ProjectMobile on a new phone, after connecting YouTube Music on the PC
- **THEN** the phone shows YouTube Music as connected and their liked songs and playlists load

#### Scenario: Disconnect
- **WHEN** YouTube Music is disconnected on the phone
- **THEN** it is disconnected on the PC too after its next sync

### Requirement: SoundCloud profile follows the account
The connected SoundCloud profile SHALL follow the account the same way: connecting or disconnecting on one device applies to all.

#### Scenario: New PC
- **WHEN** a person logs in on a new PC after connecting SoundCloud on their phone
- **THEN** the PC shows their SoundCloud likes without connecting again

### Requirement: Spotify needs one tap per device
The Spotify Client ID SHALL follow the account, so connecting Spotify on another device needs no typing: one "Connect" tap and Spotify's own approval. Each device SHALL keep its own Spotify sign-in, because sharing one would sign the other devices out.

#### Scenario: Spotify on a new phone
- **WHEN** a person who connected Spotify on the PC logs in on a new phone
- **THEN** Settings shows Spotify as "Tap to connect", with the Client ID already filled in, and one tap opens Spotify's approval page

### Requirement: Sign-ins are encrypted on the device
Platform sign-ins SHALL be encrypted on the device with the account's encryption key before leaving it, and decrypted only on the account's devices. The server SHALL only ever store the encrypted form.

#### Scenario: Server copy
- **WHEN** the server's stored copy of a person's platform sign-ins is read without their password or recovery code
- **THEN** it reveals nothing about the platform accounts

### Requirement: Sign-ins removed on log out
Logging out SHALL remove from that device the platform sign-ins that arrived through the account, so a shared or sold device does not stay signed in.

#### Scenario: Log out of a friend's PC
- **WHEN** a person logs out of ProjectM on a friend's PC
- **THEN** that PC is no longer signed in to their YouTube Music or SoundCloud
