// Songs ⇄ share links and files.
// Link format: compact JSON → deflate (native CompressionStream) → base64url.

import { normalizeSong } from './model.js';

export const LINK_WARN_LENGTH = 6000; // chars; most browsers/chat apps handle far more, but keep links sane

/** Strip what can be regenerated or is at its default, to keep links short. */
export function compact(song) {
  return {
    v: song.v,
    title: song.title,
    tempo: song.tempo,
    ...(song.swing ? { swing: song.swing } : {}),
    key: song.key,
    scale: song.scale,
    ...(song.transpose ? { transpose: song.transpose } : {}),
    sections: song.sections.map((s) => ({
      id: s.id,
      name: s.name,
      bars: s.bars,
      meter: s.meter,
      chords: s.chords,
      ...(s.melody.length ? { melody: s.melody } : {}),
      bass: s.bass,
      drums: s.drums,
    })),
    arrangement: song.arrangement,
  };
}

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

function toBase64Url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export async function encodeSong(song) {
  const json = new TextEncoder().encode(JSON.stringify(compact(song)));
  return toBase64Url(await pipe(json, new CompressionStream('deflate')));
}

export async function decodeSong(str) {
  const bytes = await pipe(fromBase64Url(str), new DecompressionStream('deflate'));
  return normalizeSong(JSON.parse(new TextDecoder().decode(bytes)));
}

export function songToFile(song) {
  return new Blob([JSON.stringify(song, null, 2)], { type: 'application/json' });
}

export async function songFromFile(file) {
  return normalizeSong(JSON.parse(await file.text()));
}

export function safeFilename(title) {
  return (title || 'song').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'song';
}
