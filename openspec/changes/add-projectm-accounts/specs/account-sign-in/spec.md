# Spec Delta

## Purpose

Lets each person create one ProjectM account and use it on any number of PCs and iPhones, without the server ever learning their password.

## ADDED Requirements

### Requirement: Create an account
ProjectM (Windows) and ProjectMobile (iOS) SHALL let a person create an account with an email address and a password of at least 8 characters. An email address SHALL belong to at most one account.

#### Scenario: New account
- **WHEN** a person enters an unused email and an 8+ character password and confirms
- **THEN** the account is created and that device is logged in to it

#### Scenario: Email already used
- **WHEN** a person signs up with an email that already has an account
- **THEN** sign-up is refused with "An account with this email already exists" and they are offered to log in instead

#### Scenario: Password too short
- **WHEN** the password has fewer than 8 characters
- **THEN** sign-up is not sent and the app says the password needs at least 8 characters

### Requirement: Log in on any device
Both apps SHALL let a person log in with their email and password. A wrong email or password SHALL get the same message, so it does not reveal which emails have accounts.

#### Scenario: Correct details
- **WHEN** a person logs in with the right email and password on a new device
- **THEN** the device is logged in and the account's data starts arriving

#### Scenario: Wrong details
- **WHEN** the email or the password is wrong
- **THEN** the app says "Email or password is wrong" without saying which

#### Scenario: Too many attempts
- **WHEN** 10 failed logins for one email happen within 15 minutes
- **THEN** further attempts for that email are refused for 15 minutes with a message saying when to try again

### Requirement: Password stays on the device
The typed password SHALL never be sent to or stored on the server. The device SHALL derive two separate keys from it: a login key sent to the server, and an encryption key that never leaves the device.

#### Scenario: Server data alone is not enough
- **WHEN** someone has a full copy of the server's data
- **THEN** they cannot recover any account's password or encryption key from it without guessing the password

### Requirement: Stay logged in
A logged-in device SHALL stay logged in across app restarts until the person logs out, the session is revoked, or the password is changed elsewhere.

#### Scenario: Restart
- **WHEN** the app is closed and opened again
- **THEN** it is still logged in and syncing without asking for the password

#### Scenario: Session ended elsewhere
- **WHEN** the device's session is no longer valid on the server
- **THEN** the app shows it is logged out and asks for the password, keeping all data already on the device

### Requirement: Log out
Both apps SHALL let a person log out. Logging out SHALL keep the playlists, settings and history on that device, stop syncing, and forget the device's session and encryption key.

#### Scenario: Log out
- **WHEN** a person logs out
- **THEN** the device stops syncing, keeps its local data, and the account's platform sign-ins received through sync are removed from that device

### Requirement: New password from a logged-in device
Any device that is logged in SHALL be able to set a new password without the old one, which is how a forgotten password is normally replaced. The device SHALL prove it holds the account key, so a stolen session token alone cannot change the password. Every other device SHALL then need the new password; all data, including encrypted platform sign-ins, SHALL remain.

#### Scenario: Forgot the password, phone still logged in
- **WHEN** a person who forgot their password opens Settings → Account → Set new password on their phone and enters a new one
- **THEN** the phone stays logged in, the PC asks for the new password on its next sync, and everything is kept

#### Scenario: Stolen session token
- **WHEN** someone with only a device's session token tries to set a new password
- **THEN** the server refuses it

### Requirement: Owner-allowed reset
When a person has no logged-in device and no recovery code, the server owner SHALL be able to allow a reset for their email for 24 hours. During that time "Forgot password" SHALL accept a new password without a code; playlists, settings and history SHALL be kept, and platform sign-ins SHALL be removed (they can only be read with the old keys). A reset SHALL be used up once done.

#### Scenario: Reset not allowed yet
- **WHEN** a person uses "Forgot password" without a code before the owner allowed it
- **THEN** the app explains that the server owner must allow a reset and that a logged-in device or the recovery code also work

#### Scenario: Reset allowed
- **WHEN** the owner ran the allow-reset command for that email and the person sets a new password within 24 hours
- **THEN** they are logged in, other devices must log in again, playlists, settings and history are there, and YouTube Music and SoundCloud need connecting again

### Requirement: Recovery code
At sign-up the app SHALL show a recovery code once, as an optional backup. The code SHALL let a person with no logged-in device set a new password without the old one, keeping all account data including encrypted platform sign-ins. The server SHALL not be able to read the code.

#### Scenario: Shown at sign-up
- **WHEN** an account is created
- **THEN** the app shows the recovery code with a copy button, explains that it's a backup, and can be closed right away

#### Scenario: Reset with the code
- **WHEN** a person who forgot their password enters their email, recovery code and a new password
- **THEN** they are logged in with the new password, every other device must log in again, all data including platform sign-ins is kept, and a new recovery code is shown

#### Scenario: Code lost too
- **WHEN** a person has no password, no recovery code and no logged-in device
- **THEN** the app tells them to ask the server owner to allow a reset

### Requirement: Devices list
Both apps SHALL show the devices logged in to the account (name, type, last seen) and let the person log out any of them.

#### Scenario: Remove a lost phone
- **WHEN** a person logs out their old phone from the PC's device list
- **THEN** that phone can no longer sync and no longer counts as a device that must receive local songs
