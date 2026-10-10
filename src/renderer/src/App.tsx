import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeftIcon } from './components/Icons'
import { ContextMenuHost, Toasts } from './components/Overlays'
import { PlayerBar } from './components/PlayerBar'
import { QueuePanel } from './components/QueuePanel'
import { Sidebar } from './components/Sidebar'
import { LikedPage, RemotePlaylistView } from './components/AccountViews'
import { preloadLiked } from './lib/liked'
import { HomeView } from './components/HomeView'
import { NowPlaying } from './components/NowPlaying'
import { HistoryView } from './components/HistoryView'
import { startListenLog } from './lib/listenLog'
import { EditPlaylistHost } from './components/EditPlaylist'
import { AlbumsView, AlbumView, PlaylistView, SearchView, SongsView, SourceView } from './components/Views'
import { initLibrary } from './lib/library'
import { initAccounts } from './lib/accounts'
import { getSettings } from './lib/settings'
import { SettingsView } from './components/SettingsView'
import { NavContext, ScrollContext, type Nav, type View } from './lib/nav'
import { connectTaskbarButtons, getPlayer, next, prev, setVolume, toggle } from './lib/player'

const sameView = (a: View, b: View) => JSON.stringify(a) === JSON.stringify(b)

/** The page to open on launch, per the "Start page" setting (settings load before first render). */
function startView(): View {
  const page = getSettings().startPage
  if (page === 'last') {
    try {
      const last = JSON.parse(localStorage.getItem('projectm.lastView') || 'null') as View | null
      if (last) return last
    } catch {
      // fall through
    }
    return { kind: 'home' }
  }
  return { kind: page }
}

export function App() {
  const [stack, setStack] = useState<View[]>([startView()])
  const [panel, setPanel] = useState<'queue' | 'nowPlaying' | null>(() => {
    try {
      return (localStorage.getItem('projectm.panel') as 'queue' | 'nowPlaying' | null) ?? 'nowPlaying'
    } catch {
      return 'nowPlaying'
    }
  })
  const togglePanel = (p: 'queue' | 'nowPlaying') =>
    setPanel((cur) => {
      const next = cur === p ? null : p
      try {
        localStorage.setItem('projectm.panel', next ?? '')
      } catch {
        // not critical
      }
      return next
    })
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
    initAccounts().then(preloadLiked)
    startListenLog()
    return connectTaskbarButtons()
  }, [])

  // remember the page for "open where I left off"
  useEffect(() => {
    try {
      localStorage.setItem('projectm.lastView', JSON.stringify(view))
    } catch {
      // not critical
    }
  }, [view])

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
          {panel === 'queue' && <QueuePanel onClose={() => togglePanel('queue')} />}
          {panel === 'nowPlaying' && (
            <NowPlaying onClose={() => togglePanel('nowPlaying')} onOpenQueue={() => togglePanel('queue')} />
          )}
          <PlayerBar panel={panel} onTogglePanel={togglePanel} />
          <EditPlaylistHost />
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
    case 'home':
      return <HomeView />
    case 'history':
      return <HistoryView tab={view.tab} />
    case 'liked':
      return <LikedPage source={view.source} />
    case 'settings':
      return <SettingsView tab={view.tab} />
    case 'remotePlaylist':
      return <RemotePlaylistView source={view.source} id={view.id} name={view.name} />
  }
}
