// Stand-in for the "file-type" package (used by music-metadata to sniff formats). The real one
// contains Node-only code the phone's JavaScript engine can't load; this knows the formats we need.

const at = (b, off, bytes) => bytes.every((v, i) => b[off + i] === v)
const ascii = (b, off, s) => at(b, off, [...s].map((ch) => ch.charCodeAt(0)))

export async function fileTypeFromBuffer(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (b.length < 4) return undefined
  // images (embedded cover art)
  if (at(b, 0, [0xff, 0xd8, 0xff])) return { ext: 'jpg', mime: 'image/jpeg' }
  if (at(b, 0, [0x89, 0x50, 0x4e, 0x47])) return { ext: 'png', mime: 'image/png' }
  if (ascii(b, 0, 'GIF8')) return { ext: 'gif', mime: 'image/gif' }
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return { ext: 'webp', mime: 'image/webp' }
  // audio
  if (ascii(b, 0, 'ID3')) return { ext: 'mp3', mime: 'audio/mpeg' }
  if (ascii(b, 0, 'fLaC')) return { ext: 'flac', mime: 'audio/flac' }
  if (ascii(b, 0, 'OggS')) return { ext: 'ogg', mime: 'audio/ogg' }
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE')) return { ext: 'wav', mime: 'audio/wav' }
  if (ascii(b, 0, 'FORM') && (ascii(b, 8, 'AIFF') || ascii(b, 8, 'AIFC'))) return { ext: 'aif', mime: 'audio/aiff' }
  if (ascii(b, 4, 'ftyp')) return { ext: 'm4a', mime: 'audio/mp4' }
  if (ascii(b, 0, 'caff')) return { ext: 'caf', mime: 'audio/x-caf' }
  // MPEG audio frame sync (MP3 without an ID3 tag), allowing some leading junk
  for (let i = 0; i < Math.min(b.length - 1, 12); i++) {
    if (b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0) return { ext: 'mp3', mime: 'audio/mpeg' }
  }
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return { ext: 'aac', mime: 'audio/aac' }
  return undefined
}

export const fileTypeFromTokenizer = async () => undefined
export const fileTypeFromStream = async () => undefined
export const fileTypeFromBlob = async (blob) => fileTypeFromBuffer(new Uint8Array(await blob.arrayBuffer()))
export const supportedExtensions = new Set()
export const supportedMimeTypes = new Set()
