import * as Clipboard from 'expo-clipboard'
import { router } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useState } from 'react'
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native'
import type { SoundCloudProfile } from '../../../../src/shared/types'
import { useStore } from '../../../../src/renderer/src/lib/store'
import { Artwork, Button, Header, Row, Txt } from '../../components/ui'
import { accountStore, cancelYouTube, connectSoundCloud, connectYouTube, deviceCodeStore, disconnect } from '../../lib/accounts'
import { cleanError, soundcloud, SOURCES } from '../../lib/sources'
import { REDIRECT_URI } from '../../lib/sources/spotify'
import { useColors, ui } from '../../lib/theme'
import { toast } from '../../lib/ui'

function Card({ children }: { children: React.ReactNode }) {
  const c = useColors()
  return <View style={{ marginHorizontal: ui.pad, marginTop: 14, backgroundColor: c.bg3, borderRadius: 12, padding: 14, gap: 10 }}>{children}</View>
}

function Title({ id, sub }: { id: 'youtube' | 'soundcloud' | 'spotify'; sub: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: SOURCES[id].color }} />
      <View style={{ flex: 1 }}>
        <Txt size={17} weight="800">
          {SOURCES[id].name}
        </Txt>
        <Txt tone="text2" size={13}>
          {sub}
        </Txt>
      </View>
    </View>
  )
}

function YouTubeCard() {
  const c = useColors()
  const a = useStore(accountStore, (s) => s.accounts.youtube)
  const code = useStore(deviceCodeStore, (s) => s.code)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const signIn = async () => {
    setBusy(true)
    setError(null)
    try {
      await connectYouTube()
      toast('YouTube Music connected')
    } catch (err) {
      const msg = cleanError(err).message
      if (!/cancelled/i.test(msg)) setError(msg)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <Title id="youtube" sub={a?.connected ? `Connected${a.userName ? ` as ${a.userName}` : ''}` : 'Your liked music and playlists'} />
      {a?.connected ? (
        <Button kind="ghost" small title="Disconnect" style={{ alignSelf: 'flex-start' }} onPress={() => disconnect('youtube')} />
      ) : busy ? (
        code ? (
          <View style={{ gap: 8 }}>
            <Txt tone="text2" size={14}>
              1. Open {code.url.replace(/^https?:\/\/(www\.)?/, '')} on this phone or any device{'\n'}2. Enter this code and pick your Google account:
            </Txt>
            <Txt size={30} weight="900" style={{ letterSpacing: 2, color: c.text }} testID="youtube-code">
              {code.code}
            </Txt>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Button small title="Copy code" kind="secondary" onPress={() => Clipboard.setStringAsync(code.code).then(() => toast('Code copied'))} />
              <Button small title="Open page" onPress={() => WebBrowser.openBrowserAsync(code.url)} />
              <Button small kind="ghost" title="Cancel" onPress={() => {
                cancelYouTube()
                setBusy(false)
              }} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator color={c.text2} size="small" />
              <Txt tone="text2" size={13}>
                Waiting for you to approve… It shows up as "YouTube on TV", that's normal.
              </Txt>
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ActivityIndicator color={c.text2} size="small" />
            <Txt tone="text2">Getting a sign-in code from Google…</Txt>
          </View>
        )
      ) : (
        <>
          <Txt tone="text2" size={13}>
            Sign in like on a smart TV: you get a code and approve it in your browser. Your password never touches ProjectM.
          </Txt>
          <Button title="Sign in with Google" style={{ alignSelf: 'flex-start' }} onPress={signIn} />
        </>
      )}
      {error ? (
        <Txt tone="text2" size={13} style={{ color: '#ff8b96' }}>
          {error}
        </Txt>
      ) : null}
    </Card>
  )
}

function SoundCloudCard() {
  const c = useColors()
  const a = useStore(accountStore, (s) => s.accounts.soundcloud)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<SoundCloudProfile[] | null>(null)
  const [busy, setBusy] = useState(false)
  const find = async () => {
    setBusy(true)
    try {
      setFound(await soundcloud.findProfiles(q))
    } catch (err) {
      toast(cleanError(err).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <Title id="soundcloud" sub={a?.connected ? `Connected as ${a.userName}` : 'Your likes and playlists (public, no password)'} />
      {a?.connected ? (
        <Button kind="ghost" small title="Disconnect" style={{ alignSelf: 'flex-start' }} onPress={() => disconnect('soundcloud')} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput
              value={q}
              onChangeText={setQ}
              onSubmitEditing={find}
              placeholder="Your SoundCloud name or profile link"
              placeholderTextColor={c.text3}
              autoCapitalize="none"
              autoCorrect={false}
              style={{ flex: 1, color: c.text, backgroundColor: c.bg4, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 }}
            />
            <Button small title="Find" busy={busy} disabled={!q.trim()} onPress={find} />
          </View>
          {found?.length === 0 ? <Txt tone="text2">No profiles found.</Txt> : null}
          {found?.map((p) => (
            <Row
              key={p.id}
              title={p.username}
              sub={`${p.followers.toLocaleString()} followers · ${p.likes.toLocaleString()} likes${p.city ? ` · ${p.city}` : ''}`}
              left={<Artwork src={p.avatar} size={40} radius={20} />}
              onPress={async () => {
                try {
                  await connectSoundCloud(`id:${p.id}`)
                  toast('SoundCloud connected')
                } catch (err) {
                  toast(cleanError(err).message)
                }
              }}
            />
          ))}
        </>
      )}
    </Card>
  )
}

function SpotifyCard() {
  const c = useColors()
  const a = useStore(accountStore, (s) => s.accounts.spotify)
  const [clientId, setClientId] = useState(a?.clientId ?? '')
  return (
    <Card>
      <Title id="spotify" sub={a?.connected ? `Connected${a.userName ? ` as ${a.userName}` : ''}` : 'Your liked songs, playlists and top songs'} />
      {a?.connected ? (
        <Button kind="ghost" small title="Disconnect" style={{ alignSelf: 'flex-start' }} onPress={() => disconnect('spotify')} />
      ) : (
        <>
          <Txt tone="text2" size={13}>
            Use the same Client ID as on your PC. In your app on developer.spotify.com, the redirect URI must be {REDIRECT_URI} (already set if the desktop app works).
          </Txt>
          <TextInput
            value={clientId}
            onChangeText={setClientId}
            placeholder="Client ID (32 letters/numbers)"
            placeholderTextColor={c.text3}
            autoCapitalize="none"
            autoCorrect={false}
            style={{ color: c.text, backgroundColor: c.bg4, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 }}
          />
          <Button
            title="Connect Spotify"
            style={{ alignSelf: 'flex-start' }}
            disabled={!/^[0-9a-f]{32}$/i.test(clientId.trim())}
            onPress={() => router.push({ pathname: '/spotify-login', params: { clientId: clientId.trim() } })}
          />
        </>
      )}
      <Txt tone="text3" size={12}>
        Phones can't play Spotify audio inside other apps, so Spotify songs play from YouTube Music or SoundCloud (the closest match).
      </Txt>
    </Card>
  )
}

export default function Accounts() {
  const c = useColors()
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title="Accounts" />
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        <SpotifyCard />
        <YouTubeCard />
        <SoundCloudCard />
      </ScrollView>
    </View>
  )
}
