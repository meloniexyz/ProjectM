import { createStore } from './store'

export interface MenuItem {
  label?: string
  onClick?: () => void
  disabled?: boolean
  danger?: boolean
  separator?: boolean
  submenu?: MenuItem[]
}

interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

export const menuStore = createStore<{ menu: MenuState | null }>({ menu: null })

export function openMenu(e: { clientX: number; clientY: number; preventDefault(): void }, items: MenuItem[]) {
  e.preventDefault()
  menuStore.set({ menu: { x: e.clientX, y: e.clientY, items } })
}

export const closeMenu = () => menuStore.set({ menu: null })

export const toastStore = createStore<{ toasts: { id: number; text: string }[] }>({ toasts: [] })
let toastId = 0

export function toast(text: string) {
  const id = ++toastId
  toastStore.set((s) => ({ toasts: [...s.toasts, { id, text }].slice(-3) }))
  setTimeout(() => toastStore.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 2600)
}
