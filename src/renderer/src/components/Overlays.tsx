import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cls } from '../lib/format'
import { useStore } from '../lib/store'
import { closeMenu, menuStore, toastStore, type MenuItem } from '../lib/ui'
import { ChevronRightIcon } from './Icons'

export function ContextMenuHost() {
  const menu = useStore(menuStore, (s) => s.menu)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  // keep the menu inside the window
  useLayoutEffect(() => {
    if (!menu || !ref.current) return setPos(null)
    const r = ref.current.getBoundingClientRect()
    setPos({
      x: Math.max(8, Math.min(menu.x, innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(menu.y, innerHeight - r.height - 8)),
    })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeMenu()
    window.addEventListener('mousedown', closeMenu)
    window.addEventListener('blur', closeMenu)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('keydown', onKey)
    document.addEventListener('scroll', closeMenu, true)
    return () => {
      window.removeEventListener('mousedown', closeMenu)
      window.removeEventListener('blur', closeMenu)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('scroll', closeMenu, true)
    }
  }, [menu])

  if (!menu) return null
  const flip = menu.x + 460 > innerWidth // open submenus to the left near the right edge
  return (
    <div
      ref={ref}
      className={cls('menu', flip && 'flip')}
      style={{ left: pos?.x ?? menu.x, top: pos?.y ?? menu.y, visibility: pos ? 'visible' : 'hidden' }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Items items={menu.items} />
    </div>
  )
}

function Items({ items }: { items: MenuItem[] }) {
  return items.map((it, i) =>
    it.separator ? (
      <div key={i} className="menu-sep" />
    ) : (
      <div
        key={i}
        className={cls('menu-item', it.danger && 'danger', it.disabled && 'disabled', it.submenu && 'has-sub')}
        onClick={(e) => {
          e.stopPropagation()
          if (it.disabled || it.submenu) return
          closeMenu()
          it.onClick?.()
        }}
      >
        <span className="label">{it.label}</span>
        {it.submenu && (
          <>
            <ChevronRightIcon size={14} />
            <div className="submenu">
              <div className="menu">
                <Items items={it.submenu} />
              </div>
            </div>
          </>
        )}
      </div>
    ),
  )
}

export function Toasts() {
  const toasts = useStore(toastStore, (s) => s.toasts)
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.text}
        </div>
      ))}
    </div>
  )
}
