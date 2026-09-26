import type { ReactNode } from 'react'
import type { SourceId } from '../../../shared/types'
import { SOURCES } from '../lib/sources'

interface P {
  size?: number
  className?: string
}

function Svg({ size = 20, className, fill, children }: P & { fill?: boolean; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? 'currentColor' : 'none'}
      stroke={fill ? 'none' : 'currentColor'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  )
}

export const PlayIcon = (p: P) => (
  <Svg {...p} fill>
    <path d="M7 4.6v14.8a1 1 0 0 0 1.52.85l12.1-7.4a1 1 0 0 0 0-1.7L8.52 3.75A1 1 0 0 0 7 4.6z" />
  </Svg>
)
export const PauseIcon = (p: P) => (
  <Svg {...p} fill>
    <rect x="5.5" y="4" width="4.5" height="16" rx="1.2" />
    <rect x="14" y="4" width="4.5" height="16" rx="1.2" />
  </Svg>
)
export const NextIcon = (p: P) => (
  <Svg {...p} fill>
    <path d="M5 4.8v14.4a.8.8 0 0 0 1.25.66L16 13.2V19a1 1 0 0 0 2 0V5a1 1 0 0 0-2 0v5.8L6.25 4.14A.8.8 0 0 0 5 4.8z" />
  </Svg>
)
export const PrevIcon = (p: P) => (
  <Svg {...p} fill>
    <path d="M19 4.8v14.4a.8.8 0 0 1-1.25.66L8 13.2V19a1 1 0 0 1-2 0V5a1 1 0 0 1 2 0v5.8l9.75-6.66A.8.8 0 0 1 19 4.8z" />
  </Svg>
)
export const ShuffleIcon = (p: P) => (
  <Svg {...p}>
    <path d="M16 3h5v5" />
    <path d="M4 20 21 3" />
    <path d="M21 16v5h-5" />
    <path d="m15 15 6 6" />
    <path d="m4 4 5 5" />
  </Svg>
)
export const RepeatIcon = ({ one, ...p }: P & { one?: boolean }) => (
  <Svg {...p}>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    {one && <path d="M11 10h1.5v4.5" strokeWidth={1.8} />}
  </Svg>
)
export const VolumeIcon = ({ level = 1, ...p }: P & { level?: number }) => (
  <Svg {...p}>
    <path d="M11 5 6 9H2v6h4l5 4V5z" />
    {level === 0 ? (
      <>
        <path d="m22 9-6 6" />
        <path d="m16 9 6 6" />
      </>
    ) : (
      <>
        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
        {level > 0.5 && <path d="M19 5a10 10 0 0 1 0 14" />}
      </>
    )}
  </Svg>
)
export const QueueIcon = (p: P) => (
  <Svg {...p}>
    <path d="M21 15V6" />
    <circle cx="18.5" cy="15.5" r="2.5" />
    <path d="M12 12H3" />
    <path d="M16 6H3" />
    <path d="M12 18H3" />
  </Svg>
)
export const SearchIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
)
export const MusicIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </Svg>
)
export const DiscIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9.5" />
    <circle cx="12" cy="12" r="2.5" />
  </Svg>
)
export const FolderIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
  </Svg>
)
export const PlaylistIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3 6h12" />
    <path d="M3 12h12" />
    <path d="M3 18h7" />
    <path d="M17 18V8l4-1" />
    <circle cx="15" cy="18" r="2" />
  </Svg>
)
export const PlusIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)
export const XIcon = (p: P) => (
  <Svg {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
)
export const TrashIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </Svg>
)
export const RefreshIcon = (p: P) => (
  <Svg {...p}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" />
    <path d="M21 3v5h-5" />
  </Svg>
)
export const ChevronLeftIcon = (p: P) => (
  <Svg {...p}>
    <path d="m15 18-6-6 6-6" />
  </Svg>
)
export const ChevronRightIcon = (p: P) => (
  <Svg {...p}>
    <path d="m9 18 6-6-6-6" />
  </Svg>
)
export const ClockIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
)

/** Small colored mark identifying where a track comes from. */
export function SourceBadge({ source, size = 16 }: { source: SourceId; size?: number }) {
  let mark: ReactNode
  switch (source) {
    case 'spotify':
      mark = (
        <>
          <circle cx="12" cy="12" r="11" fill="#1ed760" />
          <path
            d="M6.5 9.3c3.8-1.1 7.9-.8 11 1M7.2 12.5c3.1-.8 6.3-.5 8.8.9M7.9 15.5c2.4-.6 4.8-.4 6.8.7"
            stroke="#000"
            strokeWidth="1.8"
            strokeLinecap="round"
            fill="none"
          />
        </>
      )
      break
    case 'youtube':
      mark = (
        <>
          <rect x="1" y="4.5" width="22" height="15" rx="4.5" fill="#ff0033" />
          <path d="M10 8.8v6.4l5.4-3.2z" fill="#fff" />
        </>
      )
      break
    case 'soundcloud':
      mark = (
        <>
          <circle cx="12" cy="12" r="11" fill="#ff5500" />
          <path d="M7.6 15.6h8.7a2.4 2.4 0 0 0 .2-4.8 3.6 3.6 0 0 0-6.8-1.2 3 3 0 0 0-2.1 6z" fill="#fff" />
        </>
      )
      break
    default:
      mark = (
        <>
          <rect x="2" y="2" width="20" height="20" rx="6" fill="#34344a" />
          <path d="M10 16.4V8l6-1.3v8" stroke="#d6d6e8" strokeWidth="1.7" fill="none" strokeLinecap="round" />
          <circle cx="8.5" cy="16.4" r="1.7" fill="#d6d6e8" />
          <circle cx="14.5" cy="14.9" r="1.7" fill="#d6d6e8" />
        </>
      )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="source-badge" aria-label={SOURCES[source].name}>
      <title>{SOURCES[source].name}</title>
      {mark}
    </svg>
  )
}

export const NowPlayingIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M14 4v16" />
    <path d="M16.5 9h2M16.5 12h2" />
  </Svg>
)
export const HomeIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9v11h5v-6h4v6h5V9" />
  </Svg>
)
export const LevelIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 10v4M8 7v10M12 9v6M16 6v12M20 10v4" />
  </Svg>
)
export const SettingsIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Svg>
)
export const HeartIcon = (p: P & { filled?: boolean }) => (
  <Svg {...p} fill={p.filled}>
    <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.4 4.5 7 4.5c2 0 3.6 1.2 5 3 1.4-1.8 3-3 5-3 3.6 0 5.6 3.5 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" />
  </Svg>
)
