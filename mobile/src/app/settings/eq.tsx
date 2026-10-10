import { useMemo, useRef } from 'react'
import { Alert, PanResponder, Platform, ScrollView, Switch, View } from 'react-native'
import type { EqBands } from '../../../../src/shared/types'
import { BAND_LAYOUTS, bandsToCurve, convertGains, curveToBands, EQ_MAX_DB, formatFreq, PRESETS } from '../../../../src/renderer/src/lib/eq'
import { Button, Chip, Header, Row, Txt } from '../../components/ui'
import { eqCurve } from '../../lib/eq'
import { getSettings, updateSettings, useSettings } from '../../lib/settings'
import { useColors, ui } from '../../lib/theme'

const H = 190
const CURVE_FREQS = Array.from({ length: 64 }, (_, i) => 20 * Math.pow(1000, i / 63))

function BandSlider({ index, gain, freq, enabled }: { index: number; gain: number; freq: number; enabled: boolean }) {
  const c = useColors()
  const set = (y: number) => {
    const g = Math.round(Math.max(-EQ_MAX_DB, Math.min(EQ_MAX_DB, ((H / 2 - y) / (H / 2)) * EQ_MAX_DB)) * 2) / 2
    const eq = getSettings().eq
    if (eq.gains[index] === g) return
    const gains = eq.gains.slice()
    gains[index] = g
    updateSettings({ eq: { ...eq, gains, preset: 'Custom', enabled: true } })
  }
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => set(e.nativeEvent.locationY),
      onPanResponderMove: (e) => set(e.nativeEvent.locationY),
    }),
  ).current
  const y = H / 2 - (gain / EQ_MAX_DB) * (H / 2)
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Txt tone="text2" size={11} weight="700">
        {gain > 0 ? '+' : ''}
        {gain.toFixed(1)}
      </Txt>
      <View accessibilityRole="adjustable" accessibilityLabel={`${formatFreq(freq)} band`} style={{ height: H, width: 40, alignItems: 'center', marginVertical: 6 }} {...responder.panHandlers}>
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, width: 4, borderRadius: 2, backgroundColor: c.bg4 }} />
        <View pointerEvents="none" style={{ position: 'absolute', top: H / 2 - 1, width: 16, height: 2, backgroundColor: c.line2 }} />
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: y - 11, width: 22, height: 22, borderRadius: 11, backgroundColor: enabled ? c.accent : c.text3 }}
        />
      </View>
      <Txt tone="text2" size={11}>
        {formatFreq(freq)}
      </Txt>
    </View>
  )
}

export default function Equalizer() {
  const c = useColors()
  const s = useSettings()
  const eq = s.eq
  const layout = BAND_LAYOUTS[eq.bands]
  const response = useMemo(() => eqCurve(eq, CURVE_FREQS), [eq])
  const presets = [...PRESETS, ...eq.custom]

  const setBands = (bands: EqBands) => updateSettings({ eq: { ...eq, bands, gains: convertGains(eq.gains, eq.bands, bands) } })
  const applyPreset = (name: string, curve: number[]) => updateSettings({ eq: { ...eq, enabled: true, preset: name, gains: curveToBands(curve, eq.bands) } })
  const saveCustom = () => {
    const save = (name?: string) => {
      const n = name?.trim()
      if (!n) return
      const curve = bandsToCurve(eq.gains, eq.bands)
      updateSettings({ eq: { ...eq, preset: n, custom: [...eq.custom.filter((p) => p.name !== n), { name: n, curve }] } })
    }
    if (Platform.OS === 'ios') Alert.prompt('Save preset', 'Name for this EQ curve', save)
    else save(`My preset ${eq.custom.length + 1}`)
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Header title="Equalizer" />
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        <Row
          title="Equalizer"
          sub={eq.enabled ? eq.preset : 'Off'}
          icon="stats-chart-outline"
          right={<Switch accessibilityLabel="Equalizer" value={eq.enabled} onValueChange={(v) => updateSettings({ eq: { ...eq, enabled: v } })} trackColor={{ true: c.accent }} />}
        />
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: ui.pad, marginTop: 6 }}>
          {([3, 5, 7] as EqBands[]).map((b) => (
            <Chip key={b} label={`${b} bands`} active={eq.bands === b} onPress={() => setBands(b)} />
          ))}
        </View>

        {/* the curve you hear (the filter bank's real response) */}
        <View style={{ height: 80, marginHorizontal: ui.pad, marginTop: 16, flexDirection: 'row', alignItems: 'center', opacity: eq.enabled ? 1 : 0.35 }}>
          {response.map((db, i) => {
            const h = Math.min(40, (Math.abs(db) / EQ_MAX_DB) * 40)
            return (
              <View key={i} style={{ flex: 1, height: 80, justifyContent: 'center' }}>
                <View style={{ height: Math.max(1, h), backgroundColor: c.accent, opacity: 0.85, transform: [{ translateY: db >= 0 ? -h / 2 : h / 2 }] }} />
              </View>
            )
          })}
        </View>

        <View style={{ flexDirection: 'row', paddingHorizontal: 8, marginTop: 14 }}>
          {layout.map((b, i) => (
            <BandSlider key={`${eq.bands}-${i}`} index={i} freq={b.freq} gain={eq.gains[i] ?? 0} enabled={eq.enabled} />
          ))}
        </View>

        <Txt size={16} weight="800" style={{ paddingHorizontal: ui.pad, marginTop: 22 }}>
          Presets
        </Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: ui.pad }}>
          {presets.map((p) => (
            <Chip key={p.name} label={p.name} active={eq.enabled && eq.preset === p.name} onPress={() => applyPreset(p.name, p.curve)} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: ui.pad }}>
          <Button small kind="secondary" title="Save as preset" onPress={saveCustom} />
          <Button small kind="ghost" title="Reset" onPress={() => applyPreset('Flat', [0, 0, 0, 0, 0, 0, 0])} />
          {eq.custom.some((p) => p.name === eq.preset) ? (
            <Button small kind="danger" title="Delete preset" onPress={() => updateSettings({ eq: { ...eq, custom: eq.custom.filter((p) => p.name !== eq.preset), preset: 'Custom' } })} />
          ) : null}
        </View>
        <Txt tone="text3" size={12} style={{ paddingHorizontal: ui.pad, marginTop: 14 }}>
          Boosting a band never lowers the others; a limiter catches peaks so boosts don't distort.
        </Txt>
      </ScrollView>
    </View>
  )
}
