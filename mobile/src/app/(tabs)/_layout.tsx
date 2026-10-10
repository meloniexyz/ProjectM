import { Ionicons } from '@expo/vector-icons'
import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { MiniPlayer } from '../../components/MiniPlayer'
import { useColors } from '../../lib/theme'

const TABS: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap; active: keyof typeof Ionicons.glyphMap }> = {
  index: { label: 'Home', icon: 'home-outline', active: 'home' },
  search: { label: 'Search', icon: 'search-outline', active: 'search' },
  library: { label: 'Your Library', icon: 'library-outline', active: 'library' },
}

/** Mini player + tab buttons, like Spotify's bottom bar. */
function TabBar({ state, navigation, insets }: BottomTabBarProps) {
  const c = useColors()
  return (
    <View style={{ backgroundColor: c.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line, paddingBottom: insets.bottom }}>
      <View style={{ paddingTop: 6 }}>
        <MiniPlayer />
      </View>
      <View style={{ flexDirection: 'row' }}>
        {state.routes.map((route, i) => {
          const t = TABS[route.name]
          if (!t) return null
          const focused = state.index === i
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityLabel={t.label}
              testID={`tab-${route.name}`}
              accessibilityState={{ selected: focused }}
              onPress={() => {
                const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
                if (!focused && !e.defaultPrevented) navigation.navigate(route.name)
              }}
              style={{ flex: 1, alignItems: 'center', paddingVertical: 6, gap: 2 }}
            >
              <Ionicons name={focused ? t.active : t.icon} size={24} color={focused ? c.text : c.text2} />
              <Text style={{ fontSize: 11, color: focused ? c.text : c.text2, fontWeight: focused ? '700' : '500' }}>{t.label}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

export default function TabsLayout() {
  const c = useColors()
  return (
    <Tabs tabBar={(p) => <TabBar {...p} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.bg } }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="search" />
      <Tabs.Screen name="library" />
    </Tabs>
  )
}
