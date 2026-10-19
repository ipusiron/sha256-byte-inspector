/* SHA-256 Byte Inspector - MIT (c) 2026 ipusiron
 * SHA256ByteCore: pure JavaScript SHA-256 written from FIPS 180-4 with a full trace of
 * every intermediate value, the padding layout, the derivation of the constants from
 * prime roots, the step model of the stage clock and bit-difference helpers.
 * No DOM, no dependencies. All words are unsigned 32-bit numbers (x >>> 0); raw sums
 * are exact Numbers below 2^53 and `dropped` = floor(raw / 2^32) is what mod 2^32 discards.
 * This implementation exists to show the computation; production code should use
 * crypto.subtle.digest('SHA-256', ...). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SHA256ByteCore = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TWO32 = 0x100000000;

  /* FIPS 180-4 4.2.2: first 32 bits of the fractional parts of the cube roots of the
   * first 64 primes. deriveConstants() recomputes them; the tests compare both. */
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  /* FIPS 180-4 5.3.3: first 32 bits of the fractional parts of the square roots of the
   * first 8 primes. */
  const H0 = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);

  /* ---- bit operations (FIPS 180-4 3.2, 4.1.2) ---- */

  const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;
  const shr = (x, n) => x >>> n;
  const sigma0 = x => (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
  const sigma1 = x => (rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10)) >>> 0;
  const Sigma0 = x => (rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22)) >>> 0;
  const Sigma1 = x => (rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25)) >>> 0;
  const ch = (x, y, z) => ((x & y) ^ (~x & z)) >>> 0;
  const maj = (x, y, z) => ((x & y) ^ (x & z) ^ (y & z)) >>> 0;

  /* Addition mod 2^32 that keeps the exact sum. Up to 2^21 terms stay below 2^53. */
  function add32(...xs) {
    let raw = 0;
    for (const x of xs) raw += x >>> 0;
    const dropped = Math.floor(raw / TWO32);
    return { raw, dropped, out: raw - dropped * TWO32 };
  }

  /* ---- formatting ---- */

  const hexWord = x => (x >>> 0).toString(16).padStart(8, '0');
  const bin32 = x => (x >>> 0).toString(2).padStart(32, '0');

  function hexBytes(bytes, separator) {
    const parts = new Array(bytes.length);
    for (let i = 0; i < bytes.length; i += 1) parts[i] = bytes[i].toString(16).padStart(2, '0');
    return parts.join(separator == null ? '' : separator);
  }

  /* ---- bytes and padding (FIPS 180-4 5.1.1, 5.2.1) ---- */

  function toBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (Array.isArray(input)) {
      if (!input.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) throw new TypeError('bytesRequired');
      return Uint8Array.from(input);
    }
    throw new TypeError('bytesRequired');
  }

  /* Number of 64-byte blocks after padding: floor((n + 8) / 64) + 1. */
  function blockCount(length) {
    if (!Number.isInteger(length) || length < 0) throw new RangeError('invalidLength');
    return Math.floor((length + 8) / 64) + 1;
  }

  function lengthField(byteLength) {
    const bitLen = byteLength * 8;
    const bitLenHi = Math.floor(bitLen / TWO32);
    return { bitLen, bitLenHi, bitLenLo: bitLen - bitLenHi * TWO32 };
  }

  function pad(input) {
    const bytes = toBytes(input);
    const n = bytes.length;
    const blocks = blockCount(n);
    const total = blocks * 64;
    const padded = new Uint8Array(total);
    padded.set(bytes);
    padded[n] = 0x80;
    const { bitLen, bitLenHi, bitLenLo } = lengthField(n);
    const view = new DataView(padded.buffer);
    view.setUint32(total - 8, bitLenHi);
    view.setUint32(total - 4, bitLenLo);
    return {
      padded,
      layout: {
        messageEnd: n, oneBit: n, zeroStart: n + 1, zeroEnd: total - 8, lengthStart: total - 8,
        bitLen, bitLenHi, bitLenLo, blocks
      }
    };
  }

  /* ---- compression without trace (FIPS 180-4 6.2.2) ---- */

  const scratchW = new Uint32Array(64);

  /* Compresses the 64 bytes at `offset` into `state` (8 words, updated in place). */
  function compressInto(state, bytes, offset) {
    const W = scratchW;
    for (let t = 0; t < 16; t += 1) {
      const i = offset + t * 4;
      W[t] = (bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3];
    }
    for (let t = 16; t < 64; t += 1) {
      const x15 = W[t - 15];
      const x2 = W[t - 2];
      const s0 = ((x15 >>> 7) | (x15 << 25)) ^ ((x15 >>> 18) | (x15 << 14)) ^ (x15 >>> 3);
      const s1 = ((x2 >>> 17) | (x2 << 15)) ^ ((x2 >>> 19) | (x2 << 13)) ^ (x2 >>> 10);
      W[t] = W[t - 16] + s0 + W[t - 7] + s1;
    }
    let a = state[0];
    let b = state[1];
    let c = state[2];
    let d = state[3];
    let e = state[4];
    let f = state[5];
    let g = state[6];
    let h = state[7];
    for (let t = 0; t < 64; t += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const T1 = (h + S1 + ((e & f) ^ (~e & g)) + K[t] + W[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const T2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + T1) | 0;
      d = c;
      c = b;
      b = a;
      a = (T1 + T2) | 0;
    }
    state[0] += a;
    state[1] += b;
    state[2] += c;
    state[3] += d;
    state[4] += e;
    state[5] += f;
    state[6] += g;
    state[7] += h;
  }

  /* Pure compression of one block: returns the new hash value, leaves Hin untouched.
   * `block` holds the 64 bytes starting at `offset` (default 0). */
  function compress(Hin, block, offset) {
    const bytes = toBytes(block);
    const start = offset === undefined ? 0 : offset;
    if (!Number.isInteger(start) || start < 0 || start + 64 > bytes.length) throw new RangeError('invalidBlock');
    if (!Hin || Hin.length !== 8) throw new RangeError('invalidState');
    const state = Uint32Array.from(Hin);
    compressInto(state, bytes, start);
    return state;
  }

  function wordsToBytes(words) {
    const out = new Uint8Array(words.length * 4);
    for (let i = 0; i < words.length; i += 1) {
      const w = words[i];
      out[i * 4] = w >>> 24;
      out[i * 4 + 1] = (w >>> 16) & 0xff;
      out[i * 4 + 2] = (w >>> 8) & 0xff;
      out[i * 4 + 3] = w & 0xff;
    }
    return out;
  }

  /* Whole message. Hin holds the hash value before each block (8 words per block) and,
   * in its last 8 words, the digest. Blocks are traced on demand with traceBlock(). */
  function hash(input) {
    const bytes = toBytes(input);
    const { padded, layout } = pad(bytes);
    const blocks = layout.blocks;
    const Hin = new Uint32Array(8 * (blocks + 1));
    Hin.set(H0, 0);
    const state = Uint32Array.from(H0);
    for (let b = 0; b < blocks; b += 1) {
      compressInto(state, padded, b * 64);
      Hin.set(state, 8 * (b + 1));
    }
    const digest = wordsToBytes(state);
    return { bytes, padded, layout, blocks, Hin, digest, digestHex: hexBytes(digest, '') };
  }

  /* ---- compression with trace ---- */

  function compressTraced(Hin, block, index) {
    const words = new Uint32Array(16);
    const W = new Uint32Array(64);
    for (let t = 0; t < 16; t += 1) {
      words[t] = (block[t * 4] << 24) | (block[t * 4 + 1] << 16) | (block[t * 4 + 2] << 8) | block[t * 4 + 3];
      W[t] = words[t];
    }
    const schedule = new Array(48);
    for (let t = 16; t < 64; t += 1) {
      const x15 = W[t - 15];
      const x2 = W[t - 2];
      const s0 = { rotr7: rotr(x15, 7), rotr18: rotr(x15, 18), shr3: x15 >>> 3, out: 0 };
      s0.out = (s0.rotr7 ^ s0.rotr18 ^ s0.shr3) >>> 0;
      const s1 = { rotr17: rotr(x2, 17), rotr19: rotr(x2, 19), shr10: x2 >>> 10, out: 0 };
      s1.out = (s1.rotr17 ^ s1.rotr19 ^ s1.shr10) >>> 0;
      const terms = [W[t - 16], s0.out, W[t - 7], s1.out];
      const sum = add32(terms[0], terms[1], terms[2], terms[3]);
      W[t] = sum.out;
      schedule[t - 16] = { t, x15, x2, s0, s1, terms, raw: sum.raw, dropped: sum.dropped, out: sum.out };
    }
    const rounds = new Array(64);
    let before = Uint32Array.from(Hin);
    for (let t = 0; t < 64; t += 1) {
      const a = before[0];
      const b = before[1];
      const c = before[2];
      const d = before[3];
      const e = before[4];
      const f = before[5];
      const g = before[6];
      const h = before[7];
      const S1 = { rotr6: rotr(e, 6), rotr11: rotr(e, 11), rotr25: rotr(e, 25), out: 0 };
      S1.out = (S1.rotr6 ^ S1.rotr11 ^ S1.rotr25) >>> 0;
      const chv = ch(e, f, g);
      const S0 = { rotr2: rotr(a, 2), rotr13: rotr(a, 13), rotr22: rotr(a, 22), out: 0 };
      S0.out = (S0.rotr2 ^ S0.rotr13 ^ S0.rotr22) >>> 0;
      const majv = maj(a, b, c);
      const t1 = add32(h, S1.out, chv, K[t], W[t]);
      const t2 = add32(S0.out, majv);
      const eNew = add32(d, t1.out);
      const aNew = add32(t1.out, t2.out);
      const after = new Uint32Array(8);
      after[0] = aNew.out;
      after[1] = a;
      after[2] = b;
      after[3] = c;
      after[4] = eNew.out;
      after[5] = e;
      after[6] = f;
      after[7] = g;
      rounds[t] = {
        t, K: K[t], W: W[t], before, S1, ch: chv, S0, maj: majv,
        T1: { terms: [h, S1.out, chv, K[t], W[t]], raw: t1.raw, dropped: t1.dropped, out: t1.out },
        T2: { terms: [S0.out, majv], raw: t2.raw, dropped: t2.dropped, out: t2.out },
        e: eNew, a: aNew, after
      };
      before = after;
    }
    const Hout = new Uint32Array(8);
    const final = new Array(8);
    for (let i = 0; i < 8; i += 1) {
      const sum = add32(Hin[i], before[i]);
      Hout[i] = sum.out;
      final[i] = { i, h: Hin[i], v: before[i], raw: sum.raw, dropped: sum.dropped, out: sum.out };
    }
    return { index, block, words, W, Hin, Hout, schedule, rounds, final };
  }

  /* Trace of block b of a hash() result. Compression is a pure function of (Hin, block),
   * so any block can be reproduced later from the stored Hin and the padded message. */
  function traceBlock(result, b) {
    if (!result || !(result.padded instanceof Uint8Array) || !(result.Hin instanceof Uint32Array)) throw new TypeError('resultRequired');
    if (!Number.isInteger(b) || b < 0 || b >= result.blocks) throw new RangeError('invalidBlock');
    const block = result.padded.slice(b * 64, b * 64 + 64);
    const Hin = result.Hin.slice(8 * b, 8 * b + 8);
    return compressTraced(Hin, block, b);
  }

  /* ---- constants from prime roots (FIPS 180-4 4.2.2, 5.3.3) ---- */

  function firstPrimes(count) {
    const out = [];
    for (let n = 2; out.length < count; n += 1) {
      let prime = true;
      for (const p of out) {
        if (p * p > n) break;
        if (n % p === 0) { prime = false; break; }
      }
      if (prime) out.push(n);
    }
    return out;
  }

  /* floor(n ** (1 / k)) for a BigInt n >= 0 by integer Newton iteration from above. */
  function integerRoot(n, k) {
    if (n < 0n) throw new RangeError('negative');
    if (n < 2n) return n;
    const kb = BigInt(k);
    let x = 1n << BigInt(Math.ceil(n.toString(2).length / k));
    for (;;) {
      const y = ((kb - 1n) * x + n / x ** (kb - 1n)) / kb;
      if (y >= x) return x;
      x = y;
    }
  }

  const ROOT_DEGREE = { sqrt: 2, cbrt: 3 };
  const DECIMAL_DIGITS = 20;

  /* root = floor(prime ** (1 / k) * 2^32) as a BigInt; its low 32 bits are the constant. */
  function derivation(prime, kind) {
    const k = ROOT_DEGREE[kind];
    if (!k) throw new RangeError('invalidKind');
    if (!Number.isInteger(prime) || prime < 2) throw new RangeError('invalidPrime');
    const p = BigInt(prime);
    const root = integerRoot(p << BigInt(32 * k), k);
    const scaled = integerRoot(p * 10n ** BigInt(DECIMAL_DIGITS * k), k).toString().padStart(DECIMAL_DIGITS + 1, '0');
    return {
      prime,
      kind,
      root: root.toString(),
      integer: (root >> 32n).toString(),
      fraction: Number(root & 0xffffffffn).toString(16).padStart(8, '0'),
      decimal: scaled.slice(0, scaled.length - DECIMAL_DIGITS) + '.' + scaled.slice(scaled.length - DECIMAL_DIGITS)
    };
  }

  function deriveConstants() {
    const primes = firstPrimes(64);
    return {
      H: primes.slice(0, 8).map(prime => derivation(prime, 'sqrt').fraction),
      K: primes.map(prime => derivation(prime, 'cbrt').fraction),
      primes
    };
  }

  /* ---- step model of the stage clock ----
   * Step 0 is the padding of the whole message; each block then has one split step,
   * 48 schedule steps (W[16..63]), 64 round steps and one final-addition step; the
   * last step is the digest. Position ids: b1.pad, b1.split, b1.w16..b1.w63,
   * b1.r0..b1.r63, b1.add and out (blocks are numbered from 1 in ids, from 0 in
   * positions). The digest position carries block null because it belongs to the
   * whole message. */

  const SCHEDULE_STEPS = 48;
  const ROUND_STEPS = 64;
  const BLOCK_STEPS = 1 + SCHEDULE_STEPS + ROUND_STEPS + 1;
  const POSITION_ID = /^b([1-9][0-9]*)\.(pad|split|add|w(1[6-9]|[2-5][0-9]|6[0-3])|r(0|[1-9]|[1-5][0-9]|6[0-3]))$/;

  function checkBlocks(blocks) {
    if (!Number.isInteger(blocks) || blocks < 1) throw new RangeError('invalidBlocks');
  }

  function stepCount(blocks) {
    checkBlocks(blocks);
    return 1 + blocks * BLOCK_STEPS + 1;
  }

  function stepAt(blocks, k) {
    const total = stepCount(blocks);
    if (!Number.isInteger(k) || k < 0 || k >= total) throw new RangeError('invalidStep');
    if (k === 0) return { phase: 'pad', block: 0, index: 0 };
    if (k === total - 1) return { phase: 'digest', block: null, index: 0 };
    const j = k - 1;
    const block = Math.floor(j / BLOCK_STEPS);
    const r = j - block * BLOCK_STEPS;
    if (r === 0) return { phase: 'split', block, index: 0 };
    if (r <= SCHEDULE_STEPS) return { phase: 'schedule', block, index: 15 + r };
    if (r <= SCHEDULE_STEPS + ROUND_STEPS) return { phase: 'round', block, index: r - SCHEDULE_STEPS - 1 };
    return { phase: 'final', block, index: 0 };
  }

  function checkPosition(position) {
    if (!position || typeof position !== 'object') throw new TypeError('positionRequired');
    const { phase, block, index } = position;
    const blockOk = Number.isInteger(block) && block >= 0;
    const indexOk = index === undefined || index === null || index === 0;
    switch (phase) {
      case 'pad':
        if (!(block === undefined || block === null || block === 0) || !indexOk) throw new RangeError('invalidPosition');
        return;
      case 'digest':
        if (!(block === undefined || block === null || blockOk) || !indexOk) throw new RangeError('invalidPosition');
        return;
      case 'split':
      case 'final':
        if (!blockOk || !indexOk) throw new RangeError('invalidPosition');
        return;
      case 'schedule':
        if (!blockOk || !Number.isInteger(index) || index < 16 || index > 63) throw new RangeError('invalidPosition');
        return;
      case 'round':
        if (!blockOk || !Number.isInteger(index) || index < 0 || index > 63) throw new RangeError('invalidPosition');
        return;
      default:
        throw new RangeError('invalidPosition');
    }
  }

  function stepOf(blocks, position) {
    const total = stepCount(blocks);
    checkPosition(position);
    const { phase, block, index } = position;
    if (phase === 'pad') return 0;
    if (phase === 'digest') return total - 1;
    if (block >= blocks) throw new RangeError('invalidPosition');
    const base = 1 + block * BLOCK_STEPS;
    if (phase === 'split') return base;
    if (phase === 'schedule') return base + 1 + (index - 16);
    if (phase === 'round') return base + 1 + SCHEDULE_STEPS + index;
    return base + 1 + SCHEDULE_STEPS + ROUND_STEPS;
  }

  function positionId(position) {
    checkPosition(position);
    const { phase, block, index } = position;
    const prefix = 'b' + ((block || 0) + 1) + '.';
    switch (phase) {
      case 'pad': return 'b1.pad';
      case 'split': return prefix + 'split';
      case 'schedule': return prefix + 'w' + index;
      case 'round': return prefix + 'r' + index;
      case 'final': return prefix + 'add';
      default: return 'out';
    }
  }

  /* Returns null for anything that is not a canonical position id. */
  function parsePositionId(id) {
    if (typeof id !== 'string') return null;
    if (id === 'out') return { phase: 'digest', block: null, index: 0 };
    const match = POSITION_ID.exec(id);
    if (!match) return null;
    const block = Number(match[1]) - 1;
    const kind = match[2];
    if (kind === 'pad') return block === 0 ? { phase: 'pad', block: 0, index: 0 } : null;
    if (kind === 'split') return { phase: 'split', block, index: 0 };
    if (kind === 'add') return { phase: 'final', block, index: 0 };
    if (match[3] !== undefined) return { phase: 'schedule', block, index: Number(match[3]) };
    return { phase: 'round', block, index: Number(match[4]) };
  }

  /* ---- differences ---- */

  function popcount(x) {
    let v = x >>> 0;
    v -= (v >>> 1) & 0x55555555;
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    v = (v + (v >>> 4)) & 0x0f0f0f0f;
    return (v * 0x01010101) >>> 24;
  }

  /* Number of differing bits between two equally long sequences of words. */
  function diffWords(a, b) {
    if (a.length !== b.length) throw new RangeError('lengthMismatch');
    let count = 0;
    for (let i = 0; i < a.length; i += 1) count += popcount(a[i] ^ b[i]);
    return count;
  }

  /* Indices of differing bytes; a byte missing from the shorter sequence counts as different. */
  function diffBytes(a, b) {
    const out = [];
    const length = Math.max(a.length, b.length);
    for (let i = 0; i < length; i += 1) if (i >= a.length || i >= b.length || a[i] !== b[i]) out.push(i);
    return out;
  }

  function diffTrace(traceA, traceB) {
    const W = new Array(64);
    const rounds = new Array(64);
    for (let t = 0; t < 64; t += 1) {
      W[t] = popcount(traceA.W[t] ^ traceB.W[t]);
      rounds[t] = diffWords(traceA.rounds[t].after, traceB.rounds[t].after);
    }
    return { W, rounds, final: diffWords(traceA.Hout, traceB.Hout) };
  }

  return Object.freeze({
    K, H0, deriveConstants, derivation,
    rotr, shr, sigma0, sigma1, Sigma0, Sigma1, ch, maj, add32,
    blockCount, pad, compress, hash, traceBlock,
    stepCount, stepAt, stepOf, positionId, parsePositionId,
    popcount, diffWords, diffBytes, diffTrace,
    hexBytes, hexWord, bin32
  });
}));
