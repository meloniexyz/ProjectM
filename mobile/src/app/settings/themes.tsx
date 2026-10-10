import { Pressable, ScrollView, View } from 'react-native'
import { Header, Icon, Txt } from '../../components/ui'
import { updateSettings, useSettings } from '../../lib/settings'
import { ACCENT_SWATCHES, THEMES, useColors, ui } from '../../lib/theme'

export default function Themes() {
  const c = useColors()
  const s = useSettings()
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title="Themes" />
      <ScrollView contentContainerStyle={{ padding: ui.pad, paddingBottom: 60, gap: 18 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {THEMES.map((t) => {
            const on = s.theme === t.id
            const accent = s.accent ?? t.accent
            return (
              <Pressable
                key={t.id}
                accessibilityRole="button"
                accessibilityLabel={`Theme ${t.name}`}
                onPress={() => updateSettings({ theme: t.id })}
                style={{ width: '31%', borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: on ? accent : c.line2 }}
              >
                <View style={{ height: 70, backgroundColor: t.bg, padding: 8, gap: 5 }}>
                  <View style={{ height: 8, width: '70%', borderRadius: 4, backgroundColor: t.bg3 }} />
                  <View style={{ height: 8, width: '45%', borderRadius: 4, backgroundColor: t.bg4 }} />
                  <View style={{ height: 14, width: 14, borderRadius: 7, backgroundColor: accent, marginTop: 'auto' }} />
                </View>
                <View style={{ backgroundColor: t.bg2, paddingVertical: 6, paddingHorizontal: 8 }}>
                  <Txt size={12} weight="700" lines={1} style={{ color: t.text }}>
                    {t.name}
                  </Txt>
                </View>
              </Pressable>
            )
          })}
        </View>
        <View>
          <Txt size={16} weight="800">
            Accent colour
          </Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Theme's own accent"
              onPress={() => updateSettings({ accent: null })}
              style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: s.accent ? c.line2 : c.text, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="refresh" size={18} color={c.text2} />
            </Pressable>
            {ACCENT_SWATCHES.map((col) => (
              <Pressable
                key={col}
                accessibilityRole="button"
                accessibilityLabel={`Accent ${col}`}
                onPress={() => updateSettings({ accent: col })}
                style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: col, borderWidth: 3, borderColor: s.accent === col ? c.text : 'transparent' }}
              />
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  )
}
