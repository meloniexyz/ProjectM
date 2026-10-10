import * as Network from 'expo-network'
import { createStore, useStore } from '../../../src/renderer/src/lib/store'
import { getSettings, type Quality } from './settings'

export type Connection = 'wifi' | 'cellular' | 'offline'

export const netStore = createStore<{ connection: Connection }>({ connection: 'wifi' })

function classify(s: Network.NetworkState): Connection {
  if (s.isConnected === false || s.type === Network.NetworkStateType.NONE) return 'offline'
  if (s.type === Network.NetworkStateType.CELLULAR) return 'cellular'
  return 'wifi' // Wi-Fi, Ethernet, VPN over Wi-Fi...: treat as unmetered
}

let started = false
export function startNetworkWatch() {
  if (started) return
  started = true
  Network.getNetworkStateAsync().then(
    (s) => netStore.set({ connection: classify(s) }),
    () => {},
  )
  Network.addNetworkStateListener((s) => netStore.set({ connection: classify(s) }))
}

export const connection = () => netStore.get().connection
export const useConnection = () => useStore(netStore, (s) => s.connection)

/** May music use the network right now (offline mode off and connected)? */
export const canStream = () => !getSettings().offlineMode && connection() !== 'offline'
export const onWifi = () => connection() === 'wifi'

/** The streaming quality that applies on the current connection. */
export const streamQuality = (): Quality => (onWifi() ? getSettings().wifiQuality : getSettings().cellularQuality)
