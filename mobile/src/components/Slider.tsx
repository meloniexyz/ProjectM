import { useRef, useState } from 'react'
import { PanResponder, View, type LayoutChangeEvent } from 'react-native'
import { useColors } from '../lib/theme'

/** Horizontal slider (0..1). onChange while dragging, onCommit on release. */
export function Slider({
  value,
  onChange,
  onCommit,
  disabled,
  label,
}: {
  value: number
  onChange?: (v: number) => void
  onCommit: (v: number) => void
  disabled?: boolean
  label: string
}) {
  const c = useColors()
  const width = useRef(1)
  const [drag, setDrag] = useState<number | null>(null)
  const dragRef = useRef<number | null>(null)
  const at = (x: number) => Math.max(0, Math.min(1, x / width.current))
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const v = at(e.nativeEvent.locationX)
        dragRef.current = v
        setDrag(v)
        onChange?.(v)
      },
      onPanResponderMove: (e) => {
        const v = at(e.nativeEvent.locationX)
        dragRef.current = v
        setDrag(v)
        onChange?.(v)
      },
      onPanResponderRelease: () => {
        if (dragRef.current != null) onCommit(dragRef.current)
        dragRef.current = null
        setDrag(null)
      },
      onPanResponderTerminate: () => {
        dragRef.current = null
        setDrag(null)
      },
    }),
  ).current
  const v = drag ?? value
  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}
      onLayout={(e: LayoutChangeEvent) => (width.current = Math.max(1, e.nativeEvent.layout.width))}
      style={{ height: 28, justifyContent: 'center' }}
      {...responder.panHandlers}
    >
      <View pointerEvents="none" style={{ height: 4, borderRadius: 2, backgroundColor: c.bg4 }}>
        <View style={{ width: `${v * 100}%`, height: 4, borderRadius: 2, backgroundColor: drag != null ? c.accent : c.text }} />
      </View>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: `${v * 100}%`,
          marginLeft: -7,
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: c.text,
        }}
      />
    </View>
  )
}
