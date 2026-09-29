# ProjectM

A personal desktop music player that puts your local files, YouTube Music, SoundCloud and Spotify in one dark-themed app.

## Features

- **One library:** search and play from local files, YouTube Music, SoundCloud and Spotify, and mix them in the same playlists
- **Accounts:** liked songs and playlists from each connected platform, a home page with your top songs, and a + button that saves songs to liked songs or playlists
- **Spotify without the Spotify app:** if Spotify isn't open, the song plays from whichever of YouTube Music or SoundCloud has the better copy
- **Sound:** volume leveling across platforms (−14 LUFS), highest available stream quality, and a 3/5/7-band EQ with presets
- **Now playing panel:** synced lyrics (LRCLIB) and song info (MusicBrainz)
- **Listening history** with stats, plus themes and accent colors

## Build

Requires Node.js 22+.

```bash
npm install
npm run dev     # run in development
npm run dist    # build the Windows installer into dist/
```

Spotify needs a free app from the [Spotify developer dashboard](https://developer.spotify.com/dashboard) with the redirect URI `http://127.0.0.1:43821/callback`. Signing in to a YouTube account needs your own Google OAuth client (type "TVs and Limited Input devices"). The app walks you through both setups.

For personal use. YouTube and SoundCloud playback uses their unofficial web APIs.
