import Constants from 'expo-constants'
import { router } from 'expo-router'
import { Alert, ScrollView, Switch, View } from 'react-native'
import { useStore } from '../../../../src/renderer/src/lib/store'
import { Chip, Divider, Header, Row, Txt } from '../../components/ui'
import { accountStore } from '../../lib/accounts'
import { clearHistory } from '../../lib/history'
import { refreshLocalVisibility } from '../../lib/library'
import { updateSettings, useSettings, type Quality } from '../../lib/settings'
import { SOURCES } from '../../lib/sources'
import { THEMES, useColors, ui } from '../../lib/theme'

const QUALITY_LABEL: Record<Quality, string> = { low: 'Low', mid: 'Mid', best: 'Best' }

function Group({ title }: { title: string }) {
  return (
    <Txt tone="text2" size={13} weight="800" style={{ paddingHorizontal: ui.pad, marginTop: 24, marginBottom: 4 }}>
      {title.toUpperCase()}
    </Txt>
  )
}

export default function Settings() {
  const c = useColors()
  const s = useSettings()
  const accounts = useStore(accountStore, (st) => st.accounts)
  const sw = (value: boolean, onChange: (v: boolean) => void, label: string) => (
    <Switch accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ true: c.accent }} />
  )
  const accountSub = (id: 'youtube' | 'soundcloud' | 'spotify') => {
    const a = accounts[id]
    return a?.connected ? `Connected${a.userName ? ` as ${a.userName}` : ''}` : 'Not connected'
  }
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title="Settings" />
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        <Group title="Accounts" />
        {(['spotify', 'youtube', 'soundcloud'] as const).map((id) => (
          <Row
            key={id}
            title={SOURCES[id].name}
            sub={accountSub(id)}
            left={<View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: SOURCES[id].color, marginHorizontal: 6 }} />}
            onPress={() => router.push({ pathname: '/settings/accounts', params: { focus: id } })}
            chevron
          />
        ))}

        <Group title="Audio quality" />
        <Row
          title="Streaming and downloads"
          sub={`Wi-Fi: ${QUALITY_LABEL[s.wifiQuality]} · Mobile data: ${QUALITY_LABEL[s.cellularQuality]} · Downloads: ${QUALITY_LABEL[s.downloadQuality]}`}
          icon="pulse-outline"
          onPress={() => router.push('/settings/quality')}
          chevron
          testID="settings-quality"
        />

        <Group title="Data saving and storage" />
        <Row
          title="Offline mode"
          sub="Only play what's downloaded. No mobile data is used for music."
          icon="airplane-outline"
          right={sw(s.offlineMode, (v) => updateSettings({ offlineMode: v }), 'Offline mode')}
        />
        <Row title="Downloads and storage" sub="Cache size, downloaded songs, clear storage" icon="folder-outline" onPress={() => router.push('/settings/storage')} chevron />

        <Group title="Playback" />
        <Row
          title="Volume leveling"
          sub="Every song, from every platform, plays at the same loudness"
          icon="options-outline"
          right={sw(s.normalize, (v) => updateSettings({ normalize: v }), 'Volume leveling')}
        />
        {s.normalize ? (
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: ui.pad, paddingLeft: 50, paddingBottom: 8 }}>
            {(['quiet', 'normal', 'loud'] as const).map((l) => (
              <Chip key={l} label={l[0].toUpperCase() + l.slice(1)} active={s.loudnessLevel === l} onPress={() => updateSettings({ loudnessLevel: l })} />
            ))}
          </View>
        ) : null}
        <Row title="Equalizer" sub={s.eq.enabled ? `On · ${s.eq.preset}` : 'Off'} icon="stats-chart-outline" onPress={() => router.push('/settings/eq')} chevron />
        <Row title="Show lyrics" icon="text-outline" right={sw(s.showLyrics, (v) => updateSettings({ showLyrics: v }), 'Show lyrics')} />

        <Group title="Display" />
        <Row title="Themes" sub={THEMES.find((t) => t.id === s.theme)?.name ?? 'Theme'} icon="color-palette-outline" onPress={() => router.push('/settings/themes')} chevron />

        <Group title="Local files" />
        <Row
          title="Hide short clips"
          sub="Hide local audio under 30 seconds (samples, voice memos)"
          icon="cut-outline"
          right={sw(s.hideShortClips, (v) => {
            updateSettings({ hideShortClips: v })
            refreshLocalVisibility()
          }, 'Hide short clips')}
        />

        <Group title="Privacy" />
        <Row
          title="Clear listening history"
          icon="trash-outline"
          onPress={() =>
            Alert.alert('Clear listening history?', 'Every recorded play is removed from this phone.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Clear', style: 'destructive', onPress: clearHistory },
            ])
          }
        />

        <Group title="About" />
        <Row title="ProjectM for iPhone" sub={`Version ${Constants.expoConfig?.version ?? '1.0.0'}`} icon="information-circle-outline" />
        <Divider />
        <Row title="Diagnostics" sub="Check that every source works on this phone" icon="medkit-outline" onPress={() => router.push('/settings/diagnostics')} chevron testID="settings-diagnostics" />
      </ScrollView>
    </View>
  )
}
