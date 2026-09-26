import { useState } from 'react'
import { cls, fmtTime } from '../lib/format'
import { albumKey } from '../lib/library'
import { useNav } from '../lib/nav'
import {
  cycleRepeat,
  next,
  prev,
  seek,
  setVolume,
  toggle,
  toggleMute,
  toggleNormalize,
  toggleShuffle,
  usePlayer,
} from '../lib/player'
import { Artwork, Slider } from './common'
import {
  LevelIcon,
  NextIcon,
  NowPlayingIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  QueueIcon,
  RepeatIcon,
  ShuffleIcon,
  SourceBadge,
  VolumeIcon,
} from './Icons'
import { SOURCES } from '../lib/sources'
import { useSettings } from '../lib/settings'

type Panel = 'queue' | 'nowPlaying'

export function PlayerBar({ panel, onTogglePanel }: { panel: Panel | null; onTogglePanel: (p: Panel) => void }) {
  const nav = useNav()
  const track = usePlayer((s) => s.queue[s.index]?.track)
  const playing = usePlayer((s) => s.playing)
  const buffering = usePlayer((s) => s.buffering)
  const position = usePlayer((s) => s.position)
  const duration = usePlayer((s) => s.duration)
  const volume = usePlayer((s) => s.volume)
  const muted = usePlayer((s) => s.muted)
  const shuffle = usePlayer((s) => s.shuffle)
  const repeat = usePlayer((s) => s.repeat)
  const via = usePlayer((s) => s.via)
  const normalize = usePlayer((s) => s.normalize)
  const eqOn = useSettings().eq.enabled
  // while dragging the seek bar, show where you'd land without actually seeking yet
  const [preview, setPreview] = useState<number | null>(null)
  const shownPos = preview ?? position
  const level = muted ? 0 : volume

  return (
    <footer className="player">
      <div className="np">
        {track ? (
          <>
            <Artwork src={track.artwork} size={56} />
            <div className="np-text">
              <div className="t">
                <span
                  className="link"
                  onClick={() =>
                    nav.go(
                      track.source === 'local'
                        ? { kind: 'album', key: albumKey(track) }
                        : { kind: 'search', q: `${track.artist} ${track.title}` },
                    )
                  }
                >
                  {track.title}
                </span>
              </div>
              <div className="a">
                <span className="link" onClick={() => nav.go({ kind: 'search', q: track.artist })}>
                  {track.artist}
                </span>
              </div>
            </div>
            <span className="np-source" title={via ? `${SOURCES[track.source].name} song, playing from ${SOURCES[via].name}` : SOURCES[track.source].name}>
              <SourceBadge source={track.source} size={14} />
              {via && (
                <>
                  <span className="via-arrow">→</span>
                  <SourceBadge source={via} size={14} />
                </>
              )}
            </span>
          </>
        ) : (
          <div className="np-empty">Nothing playing</div>
        )}
      </div>

      <div className="ctrl">
        <div className="ctrl-buttons">
          <button className={cls('icon-btn', shuffle && 'on')} title="Shuffle" onClick={toggleShuffle}>
            <ShuffleIcon size={18} />
          </button>
          <button className="icon-btn" title="Previous (Ctrl+←)" onClick={prev} disabled={!track}>
            <PrevIcon size={20} />
          </button>
          <button
            className={cls('ctrl-play', buffering && playing && 'loading')}
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
            onClick={toggle}
            disabled={!track}
          >
            {playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
          </button>
          <button className="icon-btn" title="Next (Ctrl+→)" onClick={next} disabled={!track}>
            <NextIcon size={20} />
          </button>
          <button
            className={cls('icon-btn', repeat !== 'off' && 'on')}
            title={repeat === 'off' ? 'Repeat' : repeat === 'all' ? 'Repeat one' : 'Repeat off'}
            onClick={cycleRepeat}
          >
            <RepeatIcon size={18} one={repeat === 'one'} />
          </button>
        </div>
        <div className="seek">
          <span>{fmtTime(shownPos)}</span>
          <Slider
            label="Seek"
            value={duration ? shownPos / duration : 0}
            disabled={!track || !duration}
            onChange={(v) => setPreview(v * duration)}
            onCommit={(v) => {
              seek(v * duration)
              setPreview(null)
            }}
          />
          <span>{fmtTime(duration)}</span>
        </div>
      </div>

      <div className="extras">
        <button
          className={cls('icon-btn eq-btn', eqOn && 'on')}
          title={eqOn ? 'Equalizer: on' : 'Equalizer: off'}
          onClick={() => nav.go({ kind: 'settings', tab: 'eq' })}
        >
          EQ
        </button>
        <button
          className={cls('icon-btn', normalize && 'on')}
          title={normalize ? 'Volume leveling: on (all songs at the same loudness)' : 'Volume leveling: off'}
          onClick={toggleNormalize}
        >
          <LevelIcon size={18} />
        </button>
        <button className={cls('icon-btn', panel === 'nowPlaying' && 'on')} title="Now playing view" onClick={() => onTogglePanel('nowPlaying')}>
          <NowPlayingIcon size={18} />
        </button>
        <button className={cls('icon-btn', panel === 'queue' && 'on')} title="Queue" onClick={() => onTogglePanel('queue')}>
          <QueueIcon size={18} />
        </button>
        <button className="icon-btn" title={muted ? 'Unmute' : 'Mute'} onClick={toggleMute}>
          <VolumeIcon size={18} level={level} />
        </button>
        <Slider
          label="Volume"
          className="vol"
          value={level}
          onChange={setVolume}
          onWheel={(e) => setVolume(volume + (e.deltaY < 0 ? 0.05 : -0.05))}
        />
      </div>
    </footer>
  )
}
