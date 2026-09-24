import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeftIcon } from './components/Icons'
import { ContextMenuHost, Toasts } from './components/Overlays'
import { PlayerBar } from './components/PlayerBar'
import { QueuePanel } from './components/QueuePanel'
import { Sidebar } from './components/Sidebar'
import { AlbumsView, AlbumView, PlaylistView, SearchView, SongsView, SourceView } from './components/Views'
import { initLibrary } from './lib/library'
import { NavContext, ScrollContext, type Nav, type View } from './lib/nav'
import { getPlayer, next, prev, setVolume, toggle } from './lib/player'

const sameView = (a: View, b: View) => JSON.stringify(a) === JSON.stringify(b)

export function App() {
  const [stack, setStack] = useState<View[]>([{ kind: 'songs' }])
  const [queueOpen, setQueueOpen] = useState(false)
  const scrollRef = useRef<HTMLElement>(null)
  const view = stack[stack.length - 1]

  const nav = useMemo<Nav>(
    () => ({
      view,
      canBack: stack.length > 1,
      go: (v) => setStack((s) => (sameView(s[s.length - 1], v) ? s : [...s.slice(-49), v])),
      back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    }),
    [view, stack.length],
  )

  useEffect(() => {
    initLibrary()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
      if (e.code === 'Space' && !typing) {
        e.preventDefault()
        toggle()
      } else if (e.ctrlKey && e.key === 'ArrowRight') next()
      else if (e.ctrlKey && e.key === 'ArrowLeft') prev()
      else if (e.ctrlKey && e.key === 'ArrowUp') setVolume(getPlayer().volume + 0.05)
      else if (e.ctrlKey && e.key === 'ArrowDown') setVolume(getPlayer().volume - 0.05)
      else if (e.ctrlKey && (e.key === 'f' || e.key === 'k')) {
        e.preventDefault()
        nav.go({ kind: 'search' })
      } else if (e.altKey && e.key === 'ArrowLeft') nav.back()
    }
    // mouse "back" side button
    const onMouse = (e: MouseEvent) => e.button === 3 && nav.back()
    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseup', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mouseup', onMouse)
    }
  }, [nav])

  return (
    <NavContext.Provider value={nav}>
      <ScrollContext.Provider value={scrollRef}>
        <div className="app">
          <header className="topbar">
            <button className="nav-btn" title="Back (Alt+←)" disabled={!nav.canBack} onClick={nav.back}>
              <ChevronLeftIcon size={18} />
            </button>
            <div className="brand">
              <span className="brand-mark" />
              ProjectM
            </div>
          </header>
          <Sidebar />
          {/* keyed by view so each page starts scrolled to the top */}
          <main className="main" ref={scrollRef} key={JSON.stringify(view)}>
            <Page view={view} />
          </main>
          {queueOpen && <QueuePanel onClose={() => setQueueOpen(false)} />}
          <PlayerBar queueOpen={queueOpen} onToggleQueue={() => setQueueOpen((o) => !o)} />
          <ContextMenuHost />
          <Toasts />
        </div>
      </ScrollContext.Provider>
    </NavContext.Provider>
  )
}

function Page({ view }: { view: View }) {
  switch (view.kind) {
    case 'songs':
      return <SongsView />
    case 'albums':
      return <AlbumsView />
    case 'album':
      return <AlbumView albumKey={view.key} />
    case 'search':
      return <SearchView initial={view.q} />
    case 'playlist':
      return <PlaylistView id={view.id} />
    case 'source':
      return <SourceView source={view.source} />
  }
}
