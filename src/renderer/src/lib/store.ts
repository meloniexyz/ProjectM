import { useSyncExternalStore } from 'react'

export interface Store<T> {
  get(): T
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void
  subscribe(listener: () => void): () => void
}

/** Minimal global store; components read slices of it with useStore. */
export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
      listeners.forEach((l) => l())
    },
    subscribe(l) {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
  }
}

/** Selector must return something stable (a field, not a freshly built object). */
export function useStore<T, U>(store: Store<T>, select: (s: T) => U): U {
  return useSyncExternalStore(store.subscribe, () => select(store.get()))
}
