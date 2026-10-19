/* SHA-256 Byte Inspector - MIT (c) 2026 ipusiron
 * SHA256ByteView: pure functions that turn a SHA256ByteCore result or block trace and a
 * position into plain data for the screen: strings, numbers, arrays and objects only.
 * No DOM access, no state, no dictionary. Words are {hex, bin, dec, bits, value} where
 * bits[0] is bit 31 (MSB); sums are {raw, rawHex, dropped, out} where dropped =
 * floor(raw / 2^32) is what the reduction mod 2^32 discards and rawHex has nine digits
 * so that its first digit is `dropped`. Hexadecimal is lowercase. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sha256-core.js'));
  else root.SHA256ByteView = factory(root.SHA256ByteCore);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';

  const REGISTERS = Object.freeze(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  const PHASES = Object.freeze(['pad', 'split', 'schedule', 'round', 'final', 'digest']);
  const NEWLY = Object.freeze(['a', 'e']);
  const DEFAULT_PER_ROW = 16;
  const DEFAULT_COLORED_LIMIT = 4096;
  const RAW_DIGITS = 9;
  const DIGEST_HEX = /^[0-9a-fA-F]{64}$/;
  const HEX_RUN = /[0-9a-fA-F]+/g;
  const SPACED_DIGEST_LINE = /^(?:[0-9a-fA-F]{2} ){31}[0-9a-fA-F]{2}$/;

  /* FIPS 180-4 notation for the worksheet, built from code points so that the source
   * stays ASCII: Greek capital sigma, Greek small sigma, circled plus (exclusive or),
   * logical and, not sign. */
  const SIGMA = String.fromCharCode(0x03a3);
  const SMALL_SIGMA = String.fromCharCode(0x03c3);
  const XOR = String.fromCharCode(0x2295);
  const AND = String.fromCharCode(0x2227);
  const NOT = String.fromCharCode(0x00ac);

  const hex2 = byte => byte.toString(16).padStart(2, '0');

  /* ---- checks ---- */

  function checkResult(result) {
    if (!result || !(result.padded instanceof Uint8Array) || !(result.Hin instanceof Uint32Array) ||
      !(result.bytes instanceof Uint8Array) || !result.layout || !Number.isInteger(result.blocks)) {
      throw new TypeError('resultRequired');
    }
  }

  function checkTrace(trace) {
    if (!trace || !(trace.W instanceof Uint32Array) || trace.W.length !== 64 || !(trace.block instanceof Uint8Array) ||
      !Array.isArray(trace.schedule) || trace.schedule.length !== 48 || !Array.isArray(trace.rounds) ||
      trace.rounds.length !== 64 || !Array.isArray(trace.final) || trace.final.length !== 8) {
      throw new TypeError('traceRequired');
    }
  }

  function checkIndex(t, min, max) {
    if (!Number.isInteger(t) || t < min || t > max) throw new RangeError('invalidIndex');
  }

  function toBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (Array.isArray(input)) return Uint8Array.from(input);
    throw new TypeError('bytesRequired');
  }

  function positiveInt(value, fallback) {
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  function nonNegativeInt(value, fallback) {
    return Number.isInteger(value) && value >= 0 ? value : fallback;
  }

  /* ---- words and sums ---- */

  function bits(x) {
    const v = x >>> 0;
    const out = new Array(32);
    for (let i = 0; i < 32; i += 1) out[i] = (v >>> (31 - i)) & 1;
    return out;
  }

  function word(x) {
    const v = x >>> 0;
    return { hex: core.hexWord(v), bin: core.bin32(v), dec: String(v), value: v, bits: bits(v) };
  }

  function words(list) {
    return Array.from(list, word);
  }

  /* `entry` is an add32 result ({raw, dropped, out}) or any object carrying those three. */
  function sum(entry) {
    return {
      raw: entry.raw,
      rawHex: entry.raw.toString(16).padStart(RAW_DIGITS, '0'),
      dropped: entry.dropped,
      out: word(entry.out)
    };
  }

  /* ---- byte grid ---- */

  /* Maps every byte index to the character (from SHA256ByteInput.encodeText) that
   * produced it. Null when there are no characters (hex mode). */
  function charLookup(length, chars) {
    if (!Array.isArray(chars) || chars.length === 0) return null;
    const lookup = new Array(length).fill(null);
    for (const char of chars) {
      const end = Math.min(length, char.start + char.length);
      for (let i = char.start; i < end; i += 1) lookup[i] = char;
    }
    return lookup;
  }

  function byteGrid(bytes, chars, options) {
    const opts = options || {};
    const perRow = positiveInt(opts.perRow, DEFAULT_PER_ROW);
    const coloredLimit = nonNegativeInt(opts.coloredLimit, DEFAULT_COLORED_LIMIT);
    const data = toBytes(bytes);
    const lookup = charLookup(data.length, chars);
    const colored = Math.min(data.length, coloredLimit);
    const rows = [];
    for (let offset = 0; offset < colored; offset += perRow) {
      const end = Math.min(colored, offset + perRow);
      const cells = new Array(end - offset);
      for (let i = offset; i < end; i += 1) {
        const char = lookup ? lookup[i] : null;
        cells[i - offset] = {
          index: i,
          hex: hex2(data[i]),
          cls: char ? char.cls : 'text',
          charIndex: char ? char.index : null,
          charStart: char ? char.start === i : true
        };
      }
      rows.push({ offset, cells });
    }
    const plainRows = [];
    for (let offset = colored; offset < data.length; offset += perRow) {
      plainRows.push(core.hexBytes(data.subarray(offset, Math.min(data.length, offset + perRow)), ' '));
    }
    return { rows, truncated: data.length > coloredLimit, plainRows, plainStart: colored, perRow, total: data.length };
  }

  /* ---- padding (FIPS 180-4 5.1.1) ---- */

  function paddingModel(result) {
    checkResult(result);
    const { padded, layout } = result;
    const n = layout.messageEnd;
    const total = padded.length;
    const zeros = padded.subarray(layout.zeroStart, layout.zeroEnd);
    const zeroCount = zeros.length;
    const shownZeros = zeroCount > 4
      ? core.hexBytes(zeros.subarray(0, 2), ' ') + ' ' + core.hexBytes(zeros.subarray(zeroCount - 2), ' ')
      : core.hexBytes(zeros, ' ');
    const segments = [
      { kind: 'message', start: 0, end: n, hex: core.hexBytes(padded.subarray(0, n), ' '), count: n },
      { kind: 'one', start: layout.oneBit, end: layout.oneBit + 1, hex: hex2(padded[layout.oneBit]), count: 1 },
      { kind: 'zeros', start: layout.zeroStart, end: layout.zeroEnd, hex: shownZeros, count: zeroCount, elided: Math.max(0, zeroCount - 4) },
      { kind: 'length', start: layout.lengthStart, end: total, hex: core.hexBytes(padded.subarray(layout.lengthStart), ' '), count: 8 }
    ];
    return {
      segments,
      bitLen: layout.bitLen,
      bitLenHex: core.hexWord(layout.bitLenHi) + core.hexWord(layout.bitLenLo),
      blocks: layout.blocks,
      paddedBytes: total,
      boundary: { bytes: n, remainder: n % 64, spill: n % 64 >= 56, isTwoBlocks: layout.blocks >= 2 }
    };
  }

  /* ---- block split (FIPS 180-4 5.2.1) ---- */

  function blockModel(trace) {
    checkTrace(trace);
    const rows = new Array(16);
    for (let t = 0; t < 16; t += 1) {
      const offset = t * 4;
      rows[t] = { t, offset, word: word(trace.words[t]), bytes: Array.from(trace.block.subarray(offset, offset + 4), hex2) };
    }
    return { index: trace.index, rows };
  }

  /* ---- message schedule (FIPS 180-4 6.2.2 step 1) ---- */

  function scheduleModel(trace, t) {
    checkTrace(trace);
    checkIndex(t, 0, 63);
    if (t < 16) {
      return { t, source: 'block', word: word(trace.W[t]), bytes: Array.from(trace.block.subarray(t * 4, t * 4 + 4), hex2) };
    }
    const entry = trace.schedule[t - 16];
    return {
      t,
      source: 'schedule',
      refs: {
        t16: { index: t - 16, word: word(trace.W[t - 16]) },
        t15: { index: t - 15, word: word(trace.W[t - 15]) },
        t7: { index: t - 7, word: word(trace.W[t - 7]) },
        t2: { index: t - 2, word: word(trace.W[t - 2]) }
      },
      s0: { x: word(entry.x15), rotr7: word(entry.s0.rotr7), rotr18: word(entry.s0.rotr18), shr3: word(entry.s0.shr3), out: word(entry.s0.out) },
      s1: { x: word(entry.x2), rotr17: word(entry.s1.rotr17), rotr19: word(entry.s1.rotr19), shr10: word(entry.s1.shr10), out: word(entry.s1.out) },
      sum: Object.assign({ terms: words(entry.terms) }, sum(entry))
    };
  }

  /* ---- one round (FIPS 180-4 6.2.2 step 3) ---- */

  function roundModel(trace, t) {
    checkTrace(trace);
    checkIndex(t, 0, 63);
    const r = trace.rounds[t];
    const a = r.before[0];
    const b = r.before[1];
    const c = r.before[2];
    const d = r.before[3];
    const e = r.before[4];
    const f = r.before[5];
    const g = r.before[6];
    const bitsA = bits(a);
    const bitsB = bits(b);
    const bitsC = bits(c);
    const votes = new Array(32);
    for (let i = 0; i < 32; i += 1) votes[i] = bitsA[i] + bitsB[i] + bitsC[i];
    return {
      t,
      K: word(r.K),
      W: word(r.W),
      before: words(r.before),
      S1: { x: word(e), rotr6: word(r.S1.rotr6), rotr11: word(r.S1.rotr11), rotr25: word(r.S1.rotr25), out: word(r.S1.out) },
      ch: { e: word(e), f: word(f), g: word(g), out: word(r.ch), select: bits(e) },
      S0: { x: word(a), rotr2: word(r.S0.rotr2), rotr13: word(r.S0.rotr13), rotr22: word(r.S0.rotr22), out: word(r.S0.out) },
      maj: { a: word(a), b: word(b), c: word(c), out: word(r.maj), votes },
      T1: Object.assign({ terms: words(r.T1.terms) }, sum(r.T1)),
      T2: Object.assign({ terms: words(r.T2.terms) }, sum(r.T2)),
      e: Object.assign({ d: word(d), T1: word(r.T1.out) }, sum(r.e)),
      a: Object.assign({ T1: word(r.T1.out), T2: word(r.T2.out) }, sum(r.a)),
      after: words(r.after),
      newly: NEWLY.slice()
    };
  }

  /* ---- final addition (FIPS 180-4 6.2.2 step 4) ---- */

  function finalModel(trace) {
    checkTrace(trace);
    return {
      index: trace.index,
      lanes: trace.final.map(lane => Object.assign({ i: lane.i, h: word(lane.h), v: word(lane.v) }, sum(lane))),
      Hin: words(trace.Hin),
      Hout: words(trace.Hout)
    };
  }

  /* ---- digest ---- */

  function digestModel(result) {
    checkResult(result);
    const list = words(result.Hin.subarray(8 * result.blocks, 8 * result.blocks + 8));
    return { words: list, hex64: result.digestHex, groups: list.map(w => w.hex), bytes: Array.from(result.digest, hex2) };
  }

  /* ---- position on the stage clock ---- */

  /* `position` is a core position ({phase, block, index}) or a step index. */
  function positionModel(result, position) {
    checkResult(result);
    const pos = typeof position === 'number' ? core.stepAt(result.blocks, position) : position;
    const stepIndex = core.stepOf(result.blocks, pos);
    const phase = pos.phase;
    const block = phase === 'digest' ? null : (pos.block || 0);
    const index = phase === 'schedule' || phase === 'round' ? pos.index : 0;
    return {
      phase,
      block,
      index,
      id: core.positionId(pos),
      stepIndex,
      total: core.stepCount(result.blocks),
      labelKey: 'phase.' + phase,
      blockNumber: block === null ? null : block + 1,
      blocks: result.blocks
    };
  }

  /* ---- discarded carries over the whole message ---- */

  /* `traces` may hold already computed block traces (indexed by block); missing ones
   * are traced here. */
  function droppedStats(result, traces) {
    checkResult(result);
    const bucket = () => ({ count: 0, total: 0 });
    const stats = { schedule: bucket(), t1: bucket(), t2: bucket(), e: bucket(), a: bucket(), final: bucket(), max: 0, blocks: result.blocks };
    const tally = (target, entry) => {
      target.total += 1;
      if (entry.dropped > 0) target.count += 1;
      if (entry.dropped > stats.max) stats.max = entry.dropped;
    };
    for (let b = 0; b < result.blocks; b += 1) {
      const trace = (Array.isArray(traces) && traces[b]) || core.traceBlock(result, b);
      for (const entry of trace.schedule) tally(stats.schedule, entry);
      for (const r of trace.rounds) {
        tally(stats.t1, r.T1);
        tally(stats.t2, r.T2);
        tally(stats.e, r.e);
        tally(stats.a, r.a);
      }
      for (const lane of trace.final) tally(stats.final, lane);
    }
    return stats;
  }

  /* ---- worksheet (plain text, English, FIPS 180-4 notation) ---- */

  const fmt = w => w.hex + ' (' + w.dec + ')';
  const rawForm = s => s.rawHex.slice(0, 1) + '_' + s.rawHex.slice(1) + ' (' + String(s.raw) + ') raw; mod 2^32 drops ' + s.dropped + ' x 2^32';

  function sumLines(indent, s) {
    return [indent + '= ' + rawForm(s), indent + '= ' + fmt(s.out)];
  }

  function registerLines(label, list) {
    const pad = ' '.repeat(label.length);
    const half = (names, offset) => names.map((name, i) => name + '=' + fmt(list[i + offset])).join('  ');
    return [label + half(REGISTERS.slice(0, 4), 0), pad + half(REGISTERS.slice(4), 4)];
  }

  /* One round. The row names are fixed English (FIPS notation); `options.lang` is
   * accepted for symmetry with the screen and ignored. */
  function worksheet(result, trace, t, options) {
    checkResult(result);
    checkTrace(trace);
    checkIndex(t, 0, 63);
    void options;
    const m = roundModel(trace, t);
    const lines = [];
    lines.push('SHA-256 round t=' + t + ' (block ' + (trace.index + 1) + ' of ' + result.blocks + ')');
    lines.push(...registerLines('before: ', m.before));
    lines.push('K[' + t + '] = ' + fmt(m.K));
    lines.push('W[' + t + '] = ' + fmt(m.W));
    lines.push(SIGMA + '1(e) = ROTR^6(e) ' + XOR + ' ROTR^11(e) ' + XOR + ' ROTR^25(e)');
    lines.push('  ROTR^6(e)  = ' + fmt(m.S1.rotr6));
    lines.push('  ROTR^11(e) = ' + fmt(m.S1.rotr11));
    lines.push('  ROTR^25(e) = ' + fmt(m.S1.rotr25));
    lines.push('  ' + SIGMA + '1(e)      = ' + fmt(m.S1.out));
    lines.push('Ch(e,f,g) = (e ' + AND + ' f) ' + XOR + ' (' + NOT + 'e ' + AND + ' g) = ' + fmt(m.ch.out));
    lines.push('T1 = h + ' + SIGMA + '1(e) + Ch(e,f,g) + K[' + t + '] + W[' + t + ']');
    lines.push('   = ' + m.T1.terms.map(w => w.hex).join(' + '));
    lines.push(...sumLines('   ', m.T1));
    lines.push(SIGMA + '0(a) = ROTR^2(a) ' + XOR + ' ROTR^13(a) ' + XOR + ' ROTR^22(a)');
    lines.push('  ROTR^2(a)  = ' + fmt(m.S0.rotr2));
    lines.push('  ROTR^13(a) = ' + fmt(m.S0.rotr13));
    lines.push('  ROTR^22(a) = ' + fmt(m.S0.rotr22));
    lines.push('  ' + SIGMA + '0(a)      = ' + fmt(m.S0.out));
    lines.push('Maj(a,b,c) = (a ' + AND + ' b) ' + XOR + ' (a ' + AND + ' c) ' + XOR + ' (b ' + AND + ' c) = ' + fmt(m.maj.out));
    lines.push('T2 = ' + SIGMA + '0(a) + Maj(a,b,c)');
    lines.push('   = ' + m.T2.terms.map(w => w.hex).join(' + '));
    lines.push(...sumLines('   ', m.T2));
    lines.push('new e = d + T1 = ' + m.e.d.hex + ' + ' + m.e.T1.hex);
    lines.push(...sumLines('      ', m.e));
    lines.push('new a = T1 + T2 = ' + m.a.T1.hex + ' + ' + m.a.T2.hex);
    lines.push(...sumLines('      ', m.a));
    lines.push(...registerLines('after:  ', m.after));
    lines.push('Newly computed: a and e. Shifted: b<-a, c<-b, d<-c, f<-e, g<-f, h<-g.');
    return lines.join('\n');
  }

  /* The whole block: Hin, the 16 words, the 48 schedule words, the 64 rounds and the
   * final addition. */
  function worksheetAll(result, trace) {
    checkResult(result);
    checkTrace(trace);
    const blockNumber = trace.index + 1;
    const head = [];
    head.push('SHA-256 worksheet: block ' + blockNumber + ' of ' + result.blocks + ', message ' + result.bytes.length + ' bytes (' + result.layout.bitLen + ' bits)');
    head.push('Words are hexadecimal with the decimal value in parentheses; every sum is reduced mod 2^32.');
    head.push(...registerLines('Hin:    ', words(trace.Hin)));
    head.push('Block ' + blockNumber + ' as 16 big-endian words:');
    for (let t = 0; t < 16; t += 1) head.push('  W[' + t + '] = ' + fmt(word(trace.W[t])));
    head.push('Message schedule: W[t] = ' + SMALL_SIGMA + '1(W[t-2]) + W[t-7] + ' + SMALL_SIGMA + '0(W[t-15]) + W[t-16]');
    for (let t = 16; t < 64; t += 1) {
      const s = scheduleModel(trace, t);
      head.push('  W[' + t + '] = ' + SMALL_SIGMA + '1(' + s.refs.t2.word.hex + ')=' + s.s1.out.hex + ' + ' + s.refs.t7.word.hex +
        ' + ' + SMALL_SIGMA + '0(' + s.refs.t15.word.hex + ')=' + s.s0.out.hex + ' + ' + s.refs.t16.word.hex +
        ' = ' + rawForm(s.sum) + ' = ' + fmt(s.sum.out));
    }
    const parts = [head.join('\n')];
    for (let t = 0; t < 64; t += 1) parts.push(worksheet(result, trace, t));
    const f = finalModel(trace);
    const tail = ['Final addition: H[i] = Hin[i] + register i (mod 2^32)'];
    for (const lane of f.lanes) {
      tail.push('  H[' + lane.i + '] = ' + lane.h.hex + ' + ' + lane.v.hex + ' = ' + rawForm(lane) + ' = ' + fmt(lane.out));
    }
    tail.push('Hout: ' + f.Hout.map(w => w.hex).join(' '));
    if (trace.index === result.blocks - 1) tail.push('Digest: ' + result.digestHex);
    else tail.push('Hout becomes Hin of block ' + (blockNumber + 1) + '.');
    parts.push(tail.join('\n'));
    return parts.join('\n\n');
  }

  /* ---- copy formats (from state values, never from the DOM) ---- */

  function copyFormats(result) {
    checkResult(result);
    return {
      hex64: result.digestHex,
      bytesSpaced: core.hexBytes(result.bytes, ' '),
      bytesJoined: core.hexBytes(result.bytes, ''),
      sha256sum: result.digestHex + '  -'
    };
  }

  /* ---- comparison with a pasted digest ---- */

  /* Pulls every 64-digit hexadecimal run out of `text` (shasum, sha256sum, PowerShell
   * Get-FileHash, certutil output, or a bare value), plus lines of 32 space-separated
   * byte pairs (older certutil). Candidates are lowercased and deduplicated. `match` is
   * null unless exactly one candidate and a digest are available. */
  function compareDigest(text, digestHex) {
    const source = text == null ? '' : String(text);
    const found = [];
    const push = value => {
      const lower = value.toLowerCase();
      if (!found.includes(lower)) found.push(lower);
    };
    for (const run of source.match(HEX_RUN) || []) if (run.length === 64) push(run);
    for (const line of source.split(/\r\n|\r|\n/)) {
      const trimmed = line.trim();
      if (SPACED_DIGEST_LINE.test(trimmed)) push(trimmed.replace(/ /g, ''));
    }
    const expected = typeof digestHex === 'string' && DIGEST_HEX.test(digestHex) ? digestHex.toLowerCase() : null;
    const normalized = found.length === 1 ? found[0] : null;
    const match = normalized !== null && expected !== null ? normalized === expected : null;
    return { found, match, normalized, expected };
  }

  return Object.freeze({
    REGISTERS, PHASES,
    bits, word, byteGrid, paddingModel, blockModel, scheduleModel, roundModel, finalModel, digestModel,
    positionModel, droppedStats, worksheet, worksheetAll, copyFormats, compareDigest
  });
}));
