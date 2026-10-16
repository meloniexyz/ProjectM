import type { ProjectMAccountStatus } from '../../../main/account-sync'
import { ACCOUNT_SOURCES, initAccounts, refreshAccount } from './accounts'
import { rebuildFromLog } from './history'
import { listenLogChanged } from './listenLog'
import { createStore, useStore } from './store'

/** The ProjectM account as the main process reports it. */
export const accountStore = createStore<ProjectMAccountStatus>({ loggedIn: false, syncing: false })

// fields missing from a status (IPC drops undefined) are cleared, not kept from the last one
const apply = (s: ProjectMAccountStatus) => accountStore.set({ email: undefined, lastSync: undefined, error: undefined, needsLogin: undefined, ...s })

let started = false
export function initAccount() {
  if (started) return
  started = true
  window.api.account.status().then(apply)
  window.api.account.onStatus(apply)
  // things other devices changed (ProjectM account)
  window.api.synced.onHistory(() => {
    listenLogChanged()
    void rebuildFromLog()
  })
  window.api.synced.onPlatforms(() => {
    for (const s of ACCOUNT_SOURCES) refreshAccount(s)
    void initAccounts()
  })
}

export const useProjectMAccount = () => useStore(accountStore, (s) => s)

/** Which account dialog is open (log in, create, recovery code, ...). */
export type AccountDialogMode = 'login' | 'signup' | 'recover' | 'password' | 'delete' | { recoveryCode: string }
export const accountDialogStore = createStore<{ mode: AccountDialogMode | null }>({ mode: null })
export const openAccountDialog = (mode: AccountDialogMode) => accountDialogStore.set({ mode })
export const closeAccountDialog = () => accountDialogStore.set({ mode: null })

/** "Error invoking remote method 'x': Error: msg" -> "msg" */
export const accountError = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')

/** The first-launch "log in or create an account" prompt, until it's answered or dismissed. */
const PROMPT_KEY = 'projectm.accountPromptDone'
export function shouldPromptAccount() {
  try {
    return !localStorage.getItem(PROMPT_KEY)
  } catch {
    return false
  }
}
export function accountPromptDone() {
  try {
    localStorage.setItem(PROMPT_KEY, '1')
  } catch {
    // not critical
  }
}
