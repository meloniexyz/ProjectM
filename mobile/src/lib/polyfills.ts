/**
 * Web APIs that youtubei.js (and a few other bits) expect but React Native doesn't fully have.
 * Imported first, before anything else runs.
 */
import 'react-native-url-polyfill/auto'
import 'event-target-polyfill'
import 'web-streams-polyfill/polyfill'
import * as Crypto from 'expo-crypto'

const g = globalThis as unknown as Record<string, unknown>

if (typeof g.CustomEvent === 'undefined') {
  class CustomEventPolyfill<T> extends (g.Event as typeof Event) {
    readonly detail: T | null
    constructor(type: string, init?: CustomEventInit<T>) {
      super(type, init)
      this.detail = init?.detail ?? null
    }
  }
  g.CustomEvent = CustomEventPolyfill
}

const cryptoObj = (g.crypto ?? {}) as Record<string, unknown>
if (typeof cryptoObj.getRandomValues !== 'function') cryptoObj.getRandomValues = Crypto.getRandomValues
if (typeof cryptoObj.randomUUID !== 'function') cryptoObj.randomUUID = Crypto.randomUUID
g.crypto = cryptoObj

if (typeof g.TextDecoder === 'undefined') {
  /** Minimal UTF-8 decoder (Hermes builds without TextDecoder). */
  class Utf8Decoder {
    readonly encoding = 'utf-8'
    decode(input?: ArrayBuffer | ArrayBufferView) {
      if (!input) return ''
      const bytes =
        input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      let out = ''
      for (let i = 0; i < bytes.length; ) {
        const b = bytes[i++]
        let cp: number
        if (b < 0x80) cp = b
        else if (b < 0xe0) cp = ((b & 0x1f) << 6) | (bytes[i++] & 0x3f)
        else if (b < 0xf0) cp = ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)
        else cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)
        out += String.fromCodePoint(cp)
      }
      return out
    }
  }
  g.TextDecoder = Utf8Decoder
}
