import '../lib/polyfills'
import { DarkTheme, Stack, ThemeProvider } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useMemo } from 'react'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { SaveSheet, Toasts, TrackSheet } from '../components/Overlays'
import { boot } from '../lib/boot'
import { BotGuardHost } from '../lib/sources/botguard'
import { useColors } from '../lib/theme'

SplashScreen.preventAutoHideAsync().catch(() => {})
boot()

export default function RootLayout() {
  const c = useColors()
  const navTheme = useMemo(
    () => ({ ...DarkTheme, colors: { ...DarkTheme.colors, background: c.bg, card: c.bg, text: c.text, border: c.line, primary: c.accent } }),
    [c],
  )
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {})
  }, [])
  return (
    <SafeAreaProvider>
      <ThemeProvider value={navTheme}>
        <View style={{ flex: 1, backgroundColor: c.bg }}>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="player" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="queue" options={{ presentation: 'modal' }} />
            <Stack.Screen name="spotify-login" options={{ presentation: 'modal' }} />
          </Stack>
          <BotGuardHost />
          <TrackSheet />
          <SaveSheet />
          <Toasts />
          <StatusBar style="light" />
        </View>
      </ThemeProvider>
    </SafeAreaProvider>
  )
}
