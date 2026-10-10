import { Pressable, ScrollView, Switch, View } from 'react-native'
import { Header, Icon, Row, Txt } from '../../components/ui'
import { updateSettings, useSettings, type MobileSettings, type Quality } from '../../lib/settings'
import { useColors, ui } from '../../lib/theme'

/** What each step means here (Spotify's comparable setting in brackets). */
const STEPS: { q: Quality; title: string; detail: string; mbPerHour: string }[] = [
  {
    q: 'low',
    title: 'Low',
    detail: 'YouTube: AAC ~48 kbps when available · SoundCloud: AAC 96 kbps · Spotify songs: the smallest matching copy',
    mbPerHour: '~20–45 MB per hour',
  },
  {
    q: 'mid',
    title: 'Mid',
    detail: 'YouTube: AAC 128 kbps · SoundCloud: AAC 96 kbps · Spotify songs: the smaller matching copy',
    mbPerHour: '~45–60 MB per hour',
  },
  {
    q: 'best',
    title: 'Best',
    detail: 'The highest quality each platform offers on iPhone: YouTube AAC 128–256 kbps, SoundCloud AAC 160–256 kbps. Spotify songs: the better-sounding copy',
    mbPerHour: '~60–75 MB per hour',
  },
]

function Picker({ title, sub, field }: { title: string; sub: string; field: keyof Pick<MobileSettings, 'wifiQuality' | 'cellularQuality' | 'downloadQuality'> }) {
  const c = useColors()
  const s = useSettings()
  return (
    <View style={{ marginTop: 22 }}>
      <Txt size={17} weight="800" style={{ paddingHorizontal: ui.pad }}>
        {title}
      </Txt>
      <Txt tone="text2" size={13} style={{ paddingHorizontal: ui.pad, marginTop: 2, marginBottom: 6 }}>
        {sub}
      </Txt>
      {STEPS.map((step) => {
        const on = s[field] === step.q
        return (
          <Pressable
            key={step.q}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${title}: ${step.title}`}
            testID={`${field}-${step.q}`}
            onPress={() => updateSettings({ [field]: step.q } as Partial<MobileSettings>)}
            style={({ pressed }) => ({ flexDirection: 'row', gap: 12, paddingHorizontal: ui.pad, paddingVertical: 10, backgroundColor: pressed ? c.hover : 'transparent' })}
          >
            <Icon name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? c.accent : c.text3} />
            <View style={{ flex: 1 }}>
              <Txt size={15} weight="700">
                {step.title} <Txt tone="text2" size={13}>· {step.mbPerHour}</Txt>
              </Txt>
              <Txt tone="text2" size={12} style={{ marginTop: 2 }}>
                {step.detail}
              </Txt>
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

export default function QualitySettings() {
  const c = useColors()
  const s = useSettings()
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title="Audio quality" />
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        <Txt tone="text2" size={13} style={{ paddingHorizontal: ui.pad }}>
          Songs you've played are kept on the phone, so playing them again uses no data. iPhones can't play YouTube's and SoundCloud's Opus streams, so ProjectM uses their AAC versions.
        </Txt>
        <Picker title="Wi-Fi streaming" sub="Quality when you're on Wi-Fi" field="wifiQuality" />
        <Picker title="Mobile data streaming" sub="Quality on mobile data. Lower saves data." field="cellularQuality" />
        <Picker title="Download" sub="Quality of songs saved for offline listening" field="downloadQuality" />
        <View style={{ marginTop: 18 }}>
          <Row
            title="Download using mobile data"
            sub="Off: offline playlists download on Wi-Fi only"
            icon="cellular-outline"
            right={
              <Switch accessibilityLabel="Download using mobile data" value={s.downloadOnCellular} onValueChange={(v) => updateSettings({ downloadOnCellular: v })} trackColor={{ true: c.accent }} />
            }
          />
        </View>
      </ScrollView>
    </View>
  )
}
