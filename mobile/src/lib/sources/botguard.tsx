import { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'

/**
 * YouTube only serves whole songs with a "PO token" from Google's BotGuard script, which needs a
 * real browser. We run it in a tiny invisible web page on youtube.com (the same way youtube.com
 * itself does). One token is bound to the session (visitor id) and works for every song for
 * hours, so this page is only needed occasionally, not per song.
 * Protocol details follow bgutils-js (github.com/LuanRT/BgUtils).
 */

const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo'
const GOOG_API_KEY = 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw'

/** Runs inside the page (plain JS, serialized as text). Resolves to the integrity token's lifetime (s). */
const PAGE_SETUP = `async function (program, globalName, requestKey, apiKey) {
  var vm = window[globalName];
  if (!vm || !vm.a) throw new Error('BotGuard unavailable');
  var snapshot = await new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error('BotGuard load timed out')); }, 15000);
    var noop = function () {};
    vm.a(program, function (asyncSnapshot) { clearTimeout(timer); resolve(asyncSnapshot); },
      true, undefined, noop, [[], []], undefined, false, [noop, noop, noop, noop, noop]);
  });
  var signalOutput = [];
  var bgResponse = await new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error('BotGuard snapshot timed out')); }, 15000);
    snapshot(function (r) { clearTimeout(timer); resolve(r); }, [undefined, undefined, signalOutput, undefined]);
  });
  var res = await fetch('https://www.youtube.com/api/jnn/v1/GenerateIT', {
    method: 'POST',
    headers: { 'content-type': 'application/json+protobuf', 'x-goog-api-key': apiKey, 'x-user-agent': 'grpc-web-javascript/0.1' },
    body: JSON.stringify([requestKey, bgResponse])
  });
  var json = await res.json();
  var integrityToken = json[0], ttl = json[1];
  if (!integrityToken) throw new Error('no integrity token (HTTP ' + res.status + ')');
  var b64 = integrityToken.replace(/-/g, '+').replace(/_/g, '/').replace(/\\./g, '=');
  var getMinter = signalOutput[0];
  if (typeof getMinter !== 'function') throw new Error('BotGuard gave no minter');
  var minter = await getMinter(Uint8Array.from(atob(b64), function (c) { return c.charCodeAt(0); }));
  if (typeof minter !== 'function') throw new Error('BotGuard minter rejected');
  window.__projectmMint = async function (binding) {
    var bytes = await minter(new TextEncoder().encode(binding));
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_');
  };
  return ttl;
}`

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

let view: WebView | null = null
let seq = 0
const pending = new Map<number, Pending>()
let readyResolve: (() => void) | null = null
let ready: Promise<void> = new Promise((r) => (readyResolve = r))
let mounted = false

function resetReady() {
  ready = new Promise((r) => (readyResolve = r))
}

/** Evaluates an expression (may be a promise) in the page and returns its JSON-able result. */
export async function runInPage<T = unknown>(expression: string, timeoutMs = 30_000): Promise<T> {
  if (!mounted) throw new Error('YouTube helper page is not running')
  await withTimeout(ready, 20_000, 'YouTube helper page did not load')
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('YouTube helper page timed out'))
    }, timeoutMs)
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
    view?.injectJavaScript(
      `(async function(){try{var __r=await (${expression});window.ReactNativeWebView.postMessage(JSON.stringify({id:${id},ok:true,r:__r===undefined?null:__r}))}catch(e){window.ReactNativeWebView.postMessage(JSON.stringify({id:${id},ok:false,e:String((e&&e.message)||e)}))}})();true;`,
    )
  })
}

/** Runs a script in the page without waiting for a result (used for BotGuard's large interpreter). */
async function loadScript(code: string) {
  await withTimeout(ready, 20_000, 'YouTube helper page did not load')
  view?.injectJavaScript(`${code}\n;true;`)
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

export interface BotGuardChallenge {
  program: string
  globalName: string
  interpreterUrl: string
}

/** Mints a session-bound PO token. Returns the token and how long it should stay valid (s). */
export async function mintSessionToken(visitorData: string, challenge: BotGuardChallenge): Promise<{ token: string; ttl: number }> {
  const res = await fetch(`https:${challenge.interpreterUrl}`)
  if (!res.ok) throw new Error(`BotGuard script unavailable (${res.status})`)
  await loadScript(await res.text())
  const args = [challenge.program, challenge.globalName, REQUEST_KEY, GOOG_API_KEY].map((a) => JSON.stringify(a)).join(',')
  const ttl = Number(await runInPage(`(${PAGE_SETUP})(${args})`, 45_000)) || 3600
  const token = await runInPage<string>(`window.__projectmMint(${JSON.stringify(visitorData)})`)
  if (!token || typeof token !== 'string') throw new Error('BotGuard returned no token')
  return { token, ttl }
}

/** The invisible page. Mount once, near the root of the app. */
export function BotGuardHost() {
  const ref = useRef<WebView>(null)
  const [key, setKey] = useState(0) // bumping it reloads the page after a crash

  useEffect(() => {
    mounted = true
    return () => {
      mounted = false
    }
  }, [])

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: { id: number; ok: boolean; r?: unknown; e?: string }
    try {
      msg = JSON.parse(e.nativeEvent.data)
    } catch {
      return
    }
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    clearTimeout(p.timer)
    if (msg.ok) p.resolve(msg.r)
    else p.reject(new Error(msg.e ?? 'page error'))
  }

  return (
    <View style={styles.host} pointerEvents="none">
      <WebView
        key={key}
        ref={(w) => {
          ref.current = w
          view = w
        }}
        source={{ uri: 'https://www.youtube.com/robots.txt' }}
        originWhitelist={['https://*']}
        javaScriptEnabled
        incognito={false}
        onLoadEnd={() => readyResolve?.()}
        onMessage={onMessage}
        onContentProcessDidTerminate={() => {
          // iOS killed the page in the background: load it again
          resetReady()
          for (const [, p] of pending) p.reject(new Error('YouTube helper page restarted'))
          pending.clear()
          setKey((k) => k + 1)
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  host: { position: 'absolute', width: 2, height: 2, left: -10, top: -10, opacity: 0 },
})
