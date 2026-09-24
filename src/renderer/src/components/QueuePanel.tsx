import { cls, plural } from '../lib/format'
import { clearUpcoming, jump, removeAt, usePlayer, type QueueItem } from '../lib/player'
import { Artwork, Bars } from './common'
import { SourceBadge, XIcon } from './Icons'

const MAX_SHOWN = 200

export function QueuePanel({ onClose }: { onClose: () => void }) {
  const queue = usePlayer((s) => s.queue)
  const index = usePlayer((s) => s.index)
  const playing = usePlayer((s) => s.playing)
  const now = queue[index]
  const upcoming = queue.slice(index + 1, index + 1 + MAX_SHOWN)
  const hidden = queue.length - index - 1 - upcoming.length

  return (
    <aside className="queue">
      <div className="queue-head">
        <h3>Queue</h3>
        <div className="row">
          {upcoming.length > 0 && (
            <button className="btn small" onClick={clearUpcoming}>
              Clear
            </button>
          )}
          <button className="icon-btn" title="Close" onClick={onClose}>
            <XIcon size={18} />
          </button>
        </div>
      </div>
      <div className="queue-body">
        {!now ? (
          <div className="q-empty">Nothing queued. Double-click any song to start playing.</div>
        ) : (
          <>
            <div className="q-label">Now playing</div>
            <Item item={now} now playing={playing} />
            {upcoming.length > 0 && <div className="q-label">Next up</div>}
            {upcoming.map((item, j) => (
              <Item
                key={item.key}
                item={item}
                onClick={() => jump(index + 1 + j)}
                onRemove={() => removeAt(index + 1 + j)}
              />
            ))}
            {hidden > 0 && <div className="q-more">and {plural(hidden, 'more song')}</div>}
          </>
        )}
      </div>
    </aside>
  )
}

function Item(props: { item: QueueItem; now?: boolean; playing?: boolean; onClick?: () => void; onRemove?: () => void }) {
  const t = props.item.track
  return (
    <div className={cls('q-item', props.now && 'now')} onClick={props.onClick}>
      <Artwork src={t.artwork} size={40} />
      <div className="q-text">
        <div className="t">
          {props.now && <Bars paused={!props.playing} />} {t.title}
        </div>
        <div className="a">{t.artist}</div>
      </div>
      <SourceBadge source={t.source} size={14} />
      {props.onRemove && (
        <button
          className="icon-btn x"
          title="Remove from queue"
          onClick={(e) => {
            e.stopPropagation()
            props.onRemove!()
          }}
        >
          <XIcon size={16} />
        </button>
      )}
    </div>
  )
}
