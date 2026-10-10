import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { WebView, type WebViewNavigation } from 'react-native-webview'
import { Header, Txt } from '../components/ui'
import { refreshStatuses } from '../lib/accounts'
import { cleanError, spotify } from '../lib/sources'
import { REDIRECT_URI, type SpotifyAuthRequest } from '../lib/sources/spotify'
import { useColors, ui } from '../lib/theme'
import { toast } from '../lib/ui'

/** Spotify's sign-in page, inside the app. We catch the redirect back and finish the login. */
export default function SpotifyLogin() {
  const c = useColors()
  const { clientId } = useLocalSearchParams<{ clientId: string }>()
  const [req, setReq] = useState<SpotifyAuthRequest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)
  const done = useRef(false)

  useEffect(() => {
    spotify.beginLogin(clientId ?? '').then(setReq, (e) => setError(cleanError(e).message))
  }, [clientId])

  const intercept = (e: WebViewNavigation | { url: string }) => {
    if (!req || !e.url.startsWith(REDIRECT_URI)) return true
    if (done.current) return false
    done.current = true
    setFinishing(true)
    spotify
      .finishLogin(req, e.url)
      .then(() => {
        refreshStatuses()
        toast('Spotify connected')
        router.back()
      })
      .catch((err) => {
        setFinishing(false)
        setError(cleanError(err).message)
      })
    return false
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title="Connect Spotify" />
      {error ? (
        <Txt tone="text2" style={{ padding: ui.pad }}>
          {error}
        </Txt>
      ) : !req || finishing ? (
        <ActivityIndicator color={c.text2} style={{ margin: 30 }} />
      ) : (
        <WebView
          source={{ uri: req.url }}
          onShouldStartLoadWithRequest={intercept}
          onNavigationStateChange={(nav) => {
            if (nav.url.startsWith(REDIRECT_URI)) intercept(nav)
          }}
          incognito
          sharedCookiesEnabled={false}
          style={{ flex: 1, backgroundColor: '#121212' }}
        />
      )}
    </View>
  )
}
