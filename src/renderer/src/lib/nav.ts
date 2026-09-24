import { createContext, useContext, type RefObject } from 'react'
import type { SourceId } from '../../../shared/types'

export type View =
  | { kind: 'songs' }
  | { kind: 'albums' }
  | { kind: 'album'; key: string }
  | { kind: 'search'; q?: string }
  | { kind: 'playlist'; id: string }
  | { kind: 'source'; source: SourceId }

export interface Nav {
  view: View
  canBack: boolean
  go(view: View): void
  back(): void
}

export const NavContext = createContext<Nav>(null!)
export const useNav = () => useContext(NavContext)

/** The main scroll container; long lists virtualize against it. */
export const ScrollContext = createContext<RefObject<HTMLElement | null>>(null!)
