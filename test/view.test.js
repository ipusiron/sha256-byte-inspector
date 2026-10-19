/* Rendering models of trace-view.js (SHA256ByteView): pure functions from a hash()
 * result, a block trace and a position to plain data.
 *
 * Expected values come from the trace itself (checked against the NIST examples in
 * core.test.js), from test/vectors/nist-sha256-rounds.json, or from node:crypto while
 * the tests run. The hex literals below are the "abc" values that the Day118 design
 * notes name as the things to look at; each one is also derived here from the NIST
 * JSON with the bit functions of sha256-core.js, so a wrong literal fails loudly. The
 * other literals are counts (rows, cells, overflow counts), not hash values. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../sha256-core.js');
const input = require('../input-core.js');
const view = require('../trace-view.js');

const TWO32 = 2 ** 32;
const nodeHex = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const utf8 = text => new TextEncoder().encode(text);
const parseHex = hex => parseInt(hex, 16) >>> 0;
const nist = JSON.parse(fs.readFileSync(path.join(__dirname, 'vectors', 'nist-sha256-rounds.json'), 'utf8'));
const nistAbc = nist.samples.find(sample => sample.input === 'abc');
const nistTwo = nist.samples.find(sample => sample.blocks.length === 2);
assert.ok(nistAbc && nistTwo, 'nist-sha256-rounds.json must hold the one-block and the two-block sample');

const abc = core.hash(utf8('abc'));
const abcTrace = core.traceBlock(abc, 0);
const two = core.hash(utf8(nistTwo.input));
const twoTraces = [core.traceBlock(two, 0), core.traceBlock(two, 1)];

function assertWord(w, value, where) {
  const v = value >>> 0;
  assert.equal(w.value, v, `${where}: value`);
  assert.equal(w.hex, core.hexWord(v), `${where}: hex`);
  assert.equal(w.bin, core.bin32(v), `${where}: bin`);
  assert.equal(w.dec, String(v), `${where}: dec`);
  assert.equal(w.bits.length, 32, `${where}: bits`);
  assert.equal(w.bits.join(''), core.bin32(v), `${where}: bits order`);
}

function assertSum(s, entry, where) {
  assert.equal(s.raw, entry.raw, `${where}: raw`);
  assert.equal(s.dropped, entry.dropped, `${where}: dropped`);
  assert.equal(s.dropped, Math.floor(s.raw / TWO32), `${where}: dropped = floor(raw / 2^32)`);
  assert.equal(s.rawHex.length, 9, `${where}: rawHex has 9 digits`);
  assert.equal(parseInt(s.rawHex, 16), s.raw, `${where}: rawHex`);
  assert.equal(Number(s.rawHex[0]), s.dropped, `${where}: first rawHex digit is the dropped count`);
  assertWord(s.out, entry.out, `${where}: out`);
  assert.equal(s.out.value, s.raw - s.dropped * TWO32, `${where}: out = raw mod 2^32`);
}

/* ---- words ---- */

test('bits() is MSB first and word() carries hex, bin, dec and bits of the same value', () => {
  assert.deepEqual(view.bits(0x80000000), [1].concat(new Array(31).fill(0)));
  assert.deepEqual(view.bits(1), new Array(31).fill(0).concat([1]));
  assert.deepEqual(view.bits(0), new Array(32).fill(0));
  assert.deepEqual(view.bits(-1), new Array(32).fill(1));
  assertWord(view.word(0), 0, 'zero');
  assertWord(view.word(0xffffffff), 0xffffffff, 'all ones');
  assertWord(view.word(-1), 0xffffffff, 'negative input is taken unsigned');
  for (let i = 0; i < 50; i += 1) {
    const value = crypto.randomBytes(4).readUInt32BE(0);
    assertWord(view.word(value), value, `random ${i}`);
  }
  assert.deepEqual(view.REGISTERS, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  assert.deepEqual(view.PHASES, ['pad', 'split', 'schedule', 'round', 'final', 'digest']);
});

/* ---- schedule ---- */

test('scheduleModel(16) for "abc": the four references, sigma parts and the sum match the trace; W[16] equals W[0]', () => {
  const trace = abcTrace;
  const m = view.scheduleModel(trace, 16);
  assert.equal(m.t, 16);
  assert.equal(m.source, 'schedule');
  assert.deepEqual([m.refs.t16.index, m.refs.t15.index, m.refs.t7.index, m.refs.t2.index], [0, 1, 9, 14]);
  assertWord(m.refs.t16.word, trace.W[0], 'W[0]');
  assertWord(m.refs.t15.word, trace.W[1], 'W[1]');
  assertWord(m.refs.t7.word, trace.W[9], 'W[9]');
  assertWord(m.refs.t2.word, trace.W[14], 'W[14]');
  assertWord(m.s0.x, trace.W[1], 's0.x');
  assertWord(m.s0.rotr7, core.rotr(trace.W[1], 7), 's0.rotr7');
  assertWord(m.s0.rotr18, core.rotr(trace.W[1], 18), 's0.rotr18');
  assertWord(m.s0.shr3, core.shr(trace.W[1], 3), 's0.shr3');
  assertWord(m.s0.out, core.sigma0(trace.W[1]), 's0.out');
  assertWord(m.s1.x, trace.W[14], 's1.x');
  assertWord(m.s1.rotr17, core.rotr(trace.W[14], 17), 's1.rotr17');
  assertWord(m.s1.rotr19, core.rotr(trace.W[14], 19), 's1.rotr19');
  assertWord(m.s1.shr10, core.shr(trace.W[14], 10), 's1.shr10');
  assertWord(m.s1.out, core.sigma1(trace.W[14]), 's1.out');
  assert.equal(m.sum.terms.length, 4);
  assert.deepEqual(m.sum.terms.map(w => w.value), [trace.W[0], core.sigma0(trace.W[1]), trace.W[9], core.sigma1(trace.W[14])]);
  assertSum(m.sum, trace.schedule[0], 'sum');
  assert.equal(m.sum.out.value, trace.W[16]);
  /* Design note: for "abc" the other three terms are zero, so W[16] = W[0]. */
  const W = nistAbc.blocks[0].W.map(parseHex);
  assert.deepEqual([W[1], W[9], W[14]], [0, 0, 0]);
  assert.equal(m.sum.out.hex, nistAbc.blocks[0].W[0]);
  assert.equal(m.sum.out.hex, '61626380');
});

test('scheduleModel(17) for "abc" sums to 000f0000 (sigma1 of the length word); t < 16 reports the block word', () => {
  const trace = abcTrace;
  const m = view.scheduleModel(trace, 17);
  assertSum(m.sum, trace.schedule[1], 'sum');
  assert.equal(m.sum.out.value, trace.W[17]);
  const W = nistAbc.blocks[0].W.map(parseHex);
  const derived = core.add32(W[1], core.sigma0(W[2]), W[10], core.sigma1(W[15]));
  assert.equal(m.sum.out.hex, core.hexWord(derived.out));
  assert.equal(m.sum.out.hex, '000f0000');
  assert.equal(m.refs.t2.word.hex, nistAbc.blocks[0].W[15]);
  for (let t = 0; t < 16; t += 1) {
    const b = view.scheduleModel(trace, t);
    assert.equal(b.source, 'block');
    assert.equal(b.t, t);
    assertWord(b.word, trace.W[t], `W[${t}]`);
    assert.equal(b.word.hex, nistAbc.blocks[0].W[t]);
    assert.equal(b.bytes.join(''), b.word.hex);
    assert.equal(b.refs, undefined);
  }
  for (let t = 16; t < 64; t += 1) {
    const s = view.scheduleModel(trace, t);
    assertSum(s.sum, trace.schedule[t - 16], `W[${t}]`);
    assert.equal(s.sum.out.value, trace.W[t]);
  }
});

/* ---- rounds ---- */

test('roundModel(0) for "abc": T1 raw 0x154da50e8, new a 5d6aebcd and new e fa2a4622, 32 select bits and 32 vote counts', () => {
  const trace = abcTrace;
  const m = view.roundModel(trace, 0);
  assert.equal(m.t, 0);
  assert.deepEqual(m.newly, ['a', 'e']);
  m.before.forEach((w, i) => assertWord(w, trace.Hin[i], `before[${i}]`));
  assertWord(m.K, core.K[0], 'K[0]');
  assertWord(m.W, trace.W[0], 'W[0]');
  assertSum(m.T1, trace.rounds[0].T1, 'T1');
  assertSum(m.T2, trace.rounds[0].T2, 'T2');
  assertSum(m.e, trace.rounds[0].e, 'e');
  assertSum(m.a, trace.rounds[0].a, 'a');
  m.after.forEach((w, i) => assertWord(w, trace.rounds[0].after[i], `after[${i}]`));

  /* Derived from the NIST example (Hin, W[0]) with the bit functions of the core. */
  const H = nistAbc.blocks[0].Hin.map(parseHex);
  const W0 = parseHex(nistAbc.blocks[0].W[0]);
  const [a, b, c, , e, f, g, h] = H;
  const t1 = h + core.Sigma1(e) + core.ch(e, f, g) + core.K[0] + W0;
  const t2 = core.Sigma0(a) + core.maj(a, b, c);
  assert.equal(m.T1.raw, t1);
  assert.equal(m.T1.raw, 0x154da50e8);
  assert.equal(m.T1.dropped, 1);
  assert.equal(m.T1.rawHex, '154da50e8');
  assert.equal(m.T2.raw, t2);
  assert.equal(m.T2.raw, 0x108909ae5);
  assert.equal(m.after[0].hex, nistAbc.blocks[0].rounds[0].state[0]);
  assert.equal(m.after[0].hex, '5d6aebcd');
  assert.equal(m.after[4].hex, nistAbc.blocks[0].rounds[0].state[4]);
  assert.equal(m.after[4].hex, 'fa2a4622');
  assert.equal(m.a.out.hex, m.after[0].hex);
  assert.equal(m.e.out.hex, m.after[4].hex);

  assert.equal(m.ch.select.length, 32);
  assert.deepEqual(m.ch.select, view.bits(e));
  for (let i = 0; i < 32; i += 1) {
    const chosen = m.ch.select[i] === 1 ? m.ch.f.bits[i] : m.ch.g.bits[i];
    assert.equal(m.ch.out.bits[i], chosen, `Ch bit ${i}`);
  }
  assert.equal(m.maj.votes.length, 32);
  for (let i = 0; i < 32; i += 1) {
    assert.equal(m.maj.votes[i], m.maj.a.bits[i] + m.maj.b.bits[i] + m.maj.c.bits[i], `votes ${i}`);
    assert.ok(m.maj.votes[i] >= 0 && m.maj.votes[i] <= 3);
    assert.equal(m.maj.out.bits[i], m.maj.votes[i] >= 2 ? 1 : 0, `Maj bit ${i}`);
  }
  assertWord(m.S1.x, e, 'S1.x');
  assertWord(m.S1.out, core.Sigma1(e), 'S1.out');
  assertWord(m.S0.x, a, 'S0.x');
  assertWord(m.S0.out, core.Sigma0(a), 'S0.out');
  assert.deepEqual(m.T1.terms.map(w => w.value), [h, core.Sigma1(e), core.ch(e, f, g), core.K[0], W0]);
  assert.deepEqual(m.T2.terms.map(w => w.value), [core.Sigma0(a), core.maj(a, b, c)]);
});

test('roundModel for every round of both NIST samples matches the trace and the NIST states', () => {
  const cases = [[abcTrace, nistAbc.blocks[0]], [twoTraces[0], nistTwo.blocks[0]], [twoTraces[1], nistTwo.blocks[1]]];
  for (const [trace, block] of cases) {
    for (let t = 0; t < 64; t += 1) {
      const m = view.roundModel(trace, t);
      const r = trace.rounds[t];
      assert.equal(m.t, t);
      m.before.forEach((w, i) => assertWord(w, r.before[i], `block ${trace.index} t=${t} before[${i}]`));
      m.after.forEach((w, i) => assertWord(w, r.after[i], `block ${trace.index} t=${t} after[${i}]`));
      assert.deepEqual(m.after.map(w => w.hex), block.rounds[t].state);
      if (t > 0) assert.deepEqual(m.before.map(w => w.hex), block.rounds[t - 1].state);
      assertSum(m.T1, r.T1, `t=${t} T1`);
      assertSum(m.T2, r.T2, `t=${t} T2`);
      assertSum(m.e, r.e, `t=${t} e`);
      assertSum(m.a, r.a, `t=${t} a`);
      assertWord(m.e.d, r.before[3], `t=${t} e.d`);
      assertWord(m.e.T1, r.T1.out, `t=${t} e.T1`);
      assertWord(m.a.T1, r.T1.out, `t=${t} a.T1`);
      assertWord(m.a.T2, r.T2.out, `t=${t} a.T2`);
      assertWord(m.K, core.K[t], `t=${t} K`);
      assertWord(m.W, trace.W[t], `t=${t} W`);
      assert.deepEqual([m.after[1].hex, m.after[2].hex, m.after[3].hex], [m.before[0].hex, m.before[1].hex, m.before[2].hex]);
      assert.deepEqual([m.after[5].hex, m.after[6].hex, m.after[7].hex], [m.before[4].hex, m.before[5].hex, m.before[6].hex]);
    }
  }
});

/* ---- final addition and digest ---- */

test('finalModel for "abc": lanes 1, 3 and 5 overflow, Hout is the digest and the next Hin of a two-block message', () => {
  const m = view.finalModel(abcTrace);
  assert.equal(m.lanes.length, 8);
  m.lanes.forEach((lane, i) => {
    assert.equal(lane.i, i);
    assertWord(lane.h, abcTrace.Hin[i], `lane ${i} h`);
    assertWord(lane.v, abcTrace.rounds[63].after[i], `lane ${i} v`);
    assertSum(lane, abcTrace.final[i], `lane ${i}`);
    assertWord(m.Hout[i], abcTrace.Hout[i], `Hout[${i}]`);
    assertWord(m.Hin[i], abcTrace.Hin[i], `Hin[${i}]`);
  });
  const overflowing = m.lanes.filter(lane => lane.dropped === 1).map(lane => lane.i);
  const derived = nistAbc.blocks[0].Hin.map((h, i) => parseHex(h) + parseHex(nistAbc.blocks[0].rounds[63].state[i]) >= TWO32 ? i : -1).filter(i => i >= 0);
  assert.deepEqual(overflowing, derived);
  assert.deepEqual(overflowing, [1, 3, 5]);
  assert.deepEqual([m.lanes[1].dropped, m.lanes[3].dropped, m.lanes[5].dropped], [1, 1, 1]);
  assert.ok(m.lanes.every(lane => lane.dropped <= 1));
  assert.equal(m.Hout.map(w => w.hex).join(''), nodeHex(utf8('abc')));
  assert.deepEqual(m.Hout.map(w => w.hex), nistAbc.blocks[0].Hout);

  const first = view.finalModel(twoTraces[0]);
  const second = view.finalModel(twoTraces[1]);
  assert.deepEqual(first.Hout.map(w => w.hex), second.Hin.map(w => w.hex));
  assert.deepEqual(first.Hout.map(w => w.hex), nistTwo.blocks[1].Hin);
  assert.equal(second.Hout.map(w => w.hex).join(''), nodeHex(utf8(nistTwo.input)));
});

test('digestModel: eight groups of eight digits that join to the node:crypto digest, and 32 byte strings', () => {
  for (const bytes of [utf8('abc'), utf8(nistTwo.input), new Uint8Array(0), crypto.randomBytes(1000)]) {
    const result = core.hash(bytes);
    const m = view.digestModel(result);
    const expected = nodeHex(bytes);
    assert.equal(m.hex64, expected);
    assert.equal(m.groups.length, 8);
    assert.ok(m.groups.every(group => /^[0-9a-f]{8}$/.test(group)));
    assert.equal(m.groups.join(''), expected);
    assert.equal(m.words.length, 8);
    m.words.forEach((w, i) => {
      assertWord(w, result.Hin[8 * result.blocks + i], `word ${i}`);
      assert.equal(w.hex, m.groups[i]);
    });
    assert.equal(m.bytes.length, 32);
    assert.equal(m.bytes.join(''), expected);
  }
});

/* ---- byte grid ---- */

test('byteGrid: 16-byte rows with classes and character indices from encodeText, plain text for everything beyond coloredLimit', () => {
  const encoded = input.encodeText('ab\n\u3042\u{1f600}', { bom: true });
  assert.equal(encoded.bytes.length, 13);
  const grid = view.byteGrid(encoded.bytes, encoded.chars);
  assert.equal(grid.rows.length, 1);
  assert.equal(grid.rows[0].offset, 0);
  assert.equal(grid.rows[0].cells.length, 13);
  assert.deepEqual(grid.rows[0].cells.map(cell => cell.hex), Array.from(encoded.bytes, b => b.toString(16).padStart(2, '0')));
  assert.deepEqual(grid.rows[0].cells.map(cell => cell.index), Array.from({ length: 13 }, (_, i) => i));
  assert.deepEqual(grid.rows[0].cells.map(cell => cell.cls),
    ['bom', 'bom', 'bom', 'text', 'text', 'lf', 'text', 'text', 'text', 'text', 'text', 'text', 'text']);
  assert.deepEqual(grid.rows[0].cells.map(cell => cell.charIndex), [0, 0, 0, 1, 2, 3, 4, 4, 4, 5, 5, 5, 5]);
  assert.deepEqual(grid.rows[0].cells.map(cell => cell.charStart), [true, false, false, true, true, true, true, false, false, true, false, false, false]);
  assert.deepEqual([grid.truncated, grid.plainRows, grid.plainStart, grid.total], [false, [], 13, 13]);
  for (const cell of grid.rows[0].cells) assert.ok(input.CLASSES.includes(cell.cls));

  const bytes = Uint8Array.from(crypto.randomBytes(40));
  const limited = view.byteGrid(bytes, null, { perRow: 16, coloredLimit: 32 });
  assert.equal(limited.rows.length, 2);
  assert.deepEqual(limited.rows.map(row => row.offset), [0, 16]);
  assert.deepEqual(limited.rows.map(row => row.cells.length), [16, 16]);
  assert.ok(limited.rows.every(row => row.cells.every(cell => cell.cls === 'text' && cell.charIndex === null)));
  assert.equal(limited.truncated, true);
  assert.deepEqual(limited.plainRows, [core.hexBytes(bytes.subarray(32), ' ')]);
  assert.equal(limited.plainStart, 32);

  const exact = view.byteGrid(bytes, [], { coloredLimit: 40 });
  assert.deepEqual([exact.rows.length, exact.rows[2].cells.length, exact.truncated, exact.plainRows.length], [3, 8, false, 0]);

  const big = new Uint8Array(4097).fill(0xab);
  const defaults = view.byteGrid(big, undefined);
  assert.equal(defaults.rows.length, 256);
  assert.equal(defaults.rows.reduce((n, row) => n + row.cells.length, 0), 4096);
  assert.deepEqual([defaults.truncated, defaults.plainRows, defaults.plainStart], [true, ['ab'], 4096]);

  const plain = view.byteGrid(new Uint8Array(100), null, { perRow: 16, coloredLimit: 0 });
  assert.deepEqual([plain.rows.length, plain.plainRows.length, plain.plainRows[6].length], [0, 7, 4 * 3 - 1]);
  assert.deepEqual(view.byteGrid(new Uint8Array(0), []), { rows: [], truncated: false, plainRows: [], plainStart: 0, perRow: 16, total: 0 });
  assert.throws(() => view.byteGrid('abc', null), TypeError);
});

/* ---- padding and block split ---- */

test('paddingModel: message, 0x80, collapsed zeros and the big-endian length; 55 and 56 bytes straddle the block boundary', () => {
  const m = view.paddingModel(abc);
  assert.deepEqual(m.segments.map(s => s.kind), ['message', 'one', 'zeros', 'length']);
  const [message, one, zeros, length] = m.segments;
  assert.deepEqual([message.start, message.end, message.hex, message.count], [0, 3, core.hexBytes(utf8('abc'), ' '), 3]);
  assert.deepEqual([one.start, one.end, one.hex], [3, 4, '80']);
  assert.deepEqual([zeros.start, zeros.end, zeros.count, zeros.elided, zeros.hex], [4, 56, 64 - 3 - 1 - 8, 64 - 3 - 1 - 8 - 4, '00 00 00 00']);
  assert.deepEqual([length.start, length.end], [56, 64]);
  assert.equal(length.hex, core.hexBytes(abc.padded.subarray(56), ' '));
  assert.equal(length.hex.replace(/ /g, ''), BigInt(24).toString(16).padStart(16, '0'));
  assert.deepEqual([m.bitLen, m.bitLenHex, m.blocks, m.paddedBytes], [24, '0000000000000018', 1, 64]);
  assert.deepEqual(m.boundary, { bytes: 3, remainder: 3, spill: false, isTwoBlocks: false });
  for (const segment of m.segments) {
    assert.equal(segment.end - segment.start, segment.count);
    if (segment.kind !== 'zeros') assert.equal(segment.hex, core.hexBytes(abc.padded.subarray(segment.start, segment.end), ' '));
  }

  const fiftyFive = view.paddingModel(core.hash(new Uint8Array(55).fill(0x61)));
  assert.deepEqual([fiftyFive.blocks, fiftyFive.segments[2].count, fiftyFive.segments[2].hex, fiftyFive.boundary.isTwoBlocks, fiftyFive.boundary.spill], [1, 0, '', false, false]);
  assert.equal(fiftyFive.bitLenHex, BigInt(55 * 8).toString(16).padStart(16, '0'));
  const fiftySix = view.paddingModel(core.hash(new Uint8Array(56).fill(0x61)));
  assert.deepEqual([fiftySix.blocks, fiftySix.segments[2].count, fiftySix.boundary.isTwoBlocks, fiftySix.boundary.spill, fiftySix.paddedBytes], [2, 63, true, true, 128]);
  const empty = view.paddingModel(core.hash(new Uint8Array(0)));
  assert.deepEqual([empty.segments[0].hex, empty.segments[0].count, empty.segments[1].start, empty.segments[2].count, empty.bitLen, empty.blocks], ['', 0, 0, 55, 0, 1]);
  const small = view.paddingModel(core.hash(new Uint8Array(52)));
  assert.deepEqual([small.segments[2].count, small.segments[2].hex, small.segments[2].elided], [3, '00 00 00', 0]);
  const sixteen = view.paddingModel(core.hash(new Uint8Array(1000)));
  assert.deepEqual([sixteen.blocks, sixteen.boundary.isTwoBlocks, sixteen.boundary.remainder, sixteen.boundary.spill], [16, true, 1000 % 64, false]);
});

test('blockModel: 16 rows of four bytes that rebuild the words of both NIST samples', () => {
  for (const [trace, block] of [[abcTrace, nistAbc.blocks[0]], [twoTraces[0], nistTwo.blocks[0]], [twoTraces[1], nistTwo.blocks[1]]]) {
    const m = view.blockModel(trace);
    assert.equal(m.index, trace.index);
    assert.equal(m.rows.length, 16);
    m.rows.forEach((row, t) => {
      assert.equal(row.t, t);
      assert.equal(row.offset, t * 4);
      assertWord(row.word, trace.words[t], `row ${t}`);
      assert.equal(row.word.hex, block.W[t]);
      assert.equal(row.bytes.length, 4);
      assert.equal(row.bytes.join(''), row.word.hex);
      assert.deepEqual(row.bytes, Array.from(trace.block.subarray(t * 4, t * 4 + 4), b => b.toString(16).padStart(2, '0')));
    });
  }
});

/* ---- position ---- */

test('positionModel: every step of a two-block message maps back to its index, id and label key', () => {
  const total = core.stepCount(two.blocks);
  assert.equal(total, 230);
  for (let k = 0; k < total; k += 1) {
    const position = core.stepAt(two.blocks, k);
    const m = view.positionModel(two, position);
    assert.equal(m.stepIndex, k);
    assert.equal(m.total, total);
    assert.equal(m.id, core.positionId(position));
    assert.equal(m.phase, position.phase);
    assert.equal(m.labelKey, 'phase.' + position.phase);
    assert.ok(view.PHASES.includes(m.phase));
    assert.equal(m.blocks, 2);
    assert.deepEqual(view.positionModel(two, k), m);
    if (position.phase === 'digest') {
      assert.deepEqual([m.block, m.blockNumber, m.id], [null, null, 'out']);
    } else {
      assert.equal(m.block, position.block);
      assert.equal(m.blockNumber, position.block + 1);
    }
    if (position.phase === 'schedule' || position.phase === 'round') assert.equal(m.index, position.index);
    else assert.equal(m.index, 0);
  }
  assert.deepEqual(view.positionModel(abc, { phase: 'pad' }), view.positionModel(abc, 0));
  assert.equal(view.positionModel(abc, { phase: 'round', block: 0, index: 51 }).id, 'b1.r51');
  assert.equal(view.positionModel(abc, core.parsePositionId('b1.w16')).stepIndex, 2);
  assert.throws(() => view.positionModel(abc, { phase: 'round', block: 1, index: 0 }), RangeError);
  assert.throws(() => view.positionModel(abc, 116), RangeError);
});

/* ---- dropped carries ---- */

test('droppedStats for "abc": 35 of 48 schedule words overflow; T1 and final counts match the trace; two blocks add up', () => {
  const m = view.droppedStats(abc);
  const trace = abcTrace;
  const count = entries => entries.filter(entry => entry.dropped > 0).length;
  assert.deepEqual(m.schedule, { count: count(trace.schedule), total: 48 });
  assert.equal(m.schedule.count, 35);
  assert.equal(trace.schedule.findIndex(entry => entry.dropped > 0) + 16, 27);
  assert.deepEqual(m.t1, { count: count(trace.rounds.map(r => r.T1)), total: 64 });
  assert.deepEqual(m.t2, { count: count(trace.rounds.map(r => r.T2)), total: 64 });
  assert.deepEqual(m.e, { count: count(trace.rounds.map(r => r.e)), total: 64 });
  assert.deepEqual(m.a, { count: count(trace.rounds.map(r => r.a)), total: 64 });
  assert.deepEqual(m.final, { count: count(trace.final), total: 8 });
  assert.equal(m.final.count, 3);
  const all = [...trace.schedule, ...trace.rounds.flatMap(r => [r.T1, r.T2, r.e, r.a]), ...trace.final];
  assert.equal(m.max, Math.max(...all.map(entry => entry.dropped)));
  assert.ok(m.max >= 1 && m.max <= 4);
  assert.equal(m.blocks, 1);

  const pair = view.droppedStats(two);
  assert.deepEqual([pair.schedule.total, pair.t1.total, pair.final.total, pair.blocks], [96, 128, 16, 2]);
  const recount = key => twoTraces.reduce((n, t) => n + count(key(t)), 0);
  assert.equal(pair.schedule.count, recount(t => t.schedule));
  assert.equal(pair.t1.count, recount(t => t.rounds.map(r => r.T1)));
  assert.equal(pair.final.count, recount(t => t.final));
  /* Design note for the NIST two-block sample: 127 of 128 T1 sums and 74 of 96 schedule
   * sums overflow, the largest discard being 3 x 2^32. */
  assert.deepEqual([pair.t1.count, pair.schedule.count, pair.max], [127, 74, 3]);
  assert.deepEqual(view.droppedStats(two, twoTraces), pair);
  assert.deepEqual(view.droppedStats(two, [twoTraces[0]]), pair);
});

/* ---- worksheet ---- */

test('worksheet(t=0) carries every hex and decimal value of the round; worksheetAll holds the schedule, 64 rounds and the final addition', () => {
  const trace = abcTrace;
  const r = trace.rounds[0];
  const sheet = view.worksheet(abc, trace, 0, { lang: 'en' });
  assert.equal(sheet, view.worksheet(abc, trace, 0, { lang: 'ja' }));
  assert.equal(sheet, view.worksheet(abc, trace, 0));
  const both = v => [core.hexWord(v), String(v >>> 0)];
  const expected = [
    ...Array.from(r.before).flatMap(both),
    ...Array.from(r.after).flatMap(both),
    ...both(r.K), ...both(r.W),
    ...both(r.S1.rotr6), ...both(r.S1.rotr11), ...both(r.S1.rotr25), ...both(r.S1.out), ...both(r.ch),
    ...both(r.S0.rotr2), ...both(r.S0.rotr13), ...both(r.S0.rotr22), ...both(r.S0.out), ...both(r.maj),
    ...both(r.T1.out), String(r.T1.raw), ...both(r.T2.out), String(r.T2.raw),
    ...both(r.e.out), String(r.e.raw), ...both(r.a.out), String(r.a.raw)
  ];
  for (const value of expected) assert.ok(sheet.includes(value), `worksheet lacks ${value}`);
  assert.ok(sheet.includes('= ' + r.T1.terms.map(core.hexWord).join(' + ')));
  assert.ok(sheet.includes('1_' + core.hexWord(r.T1.out) + ' (' + r.T1.raw + ')'));
  assert.ok(sheet.includes('drops 1 x 2^32'));
  assert.ok(sheet.startsWith('SHA-256 round t=0 (block 1 of 1)'));
  assert.ok(sheet.includes('ROTR^6(e)') && sheet.includes('ROTR^25(e)') && sheet.includes('ROTR^22(a)'));
  assert.ok(sheet.includes('Ch(e,f,g)') && sheet.includes('Maj(a,b,c)'));
  assert.ok(sheet.includes(String.fromCharCode(0x03a3) + '1(e)') && sheet.includes(String.fromCharCode(0x03a3) + '0(a)'));
  assert.ok(sheet.includes(String.fromCharCode(0x2295)) && sheet.includes(String.fromCharCode(0x2227)) && sheet.includes(String.fromCharCode(0x00ac)));
  assert.doesNotMatch(sheet, /[\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/);
  assert.doesNotMatch(sheet, /\r|\t/);

  for (let t = 1; t < 64; t += 1) {
    const text = view.worksheet(abc, trace, t);
    const round = trace.rounds[t];
    assert.ok(text.startsWith('SHA-256 round t=' + t + ' '));
    for (const value of [...both(round.T1.out), String(round.T1.raw), ...both(round.a.out), ...both(round.e.out), core.hexWord(round.after[0])]) {
      assert.ok(text.includes(value), `t=${t} lacks ${value}`);
    }
  }

  const all = view.worksheetAll(abc, trace);
  assert.equal((all.match(/^SHA-256 round t=/gm) || []).length, 64);
  for (let t = 0; t < 64; t += 1) assert.ok(all.includes(view.worksheet(abc, trace, t)), `round ${t}`);
  assert.ok(all.startsWith('SHA-256 worksheet: block 1 of 1, message 3 bytes (24 bits)'));
  for (let t = 16; t < 64; t += 1) {
    assert.ok(all.includes('  W[' + t + '] = ' + String.fromCharCode(0x03c3) + '1('), `schedule line ${t}`);
    assert.ok(all.includes(' = ' + core.hexWord(trace.W[t]) + ' (' + trace.W[t] + ')'), `schedule value ${t}`);
  }
  for (const lane of trace.final) {
    assert.ok(all.includes('  H[' + lane.i + '] = ' + core.hexWord(lane.h) + ' + ' + core.hexWord(lane.v) + ' = '), `lane ${lane.i}`);
    assert.ok(all.includes(core.hexWord(lane.out) + ' (' + lane.out + ')'));
  }
  assert.ok(all.includes('Hout: ' + Array.from(trace.Hout, core.hexWord).join(' ')));
  assert.ok(all.endsWith('Digest: ' + nodeHex(utf8('abc'))));

  const firstOfTwo = view.worksheetAll(two, twoTraces[0]);
  assert.ok(firstOfTwo.startsWith('SHA-256 worksheet: block 1 of 2, message 56 bytes (448 bits)'));
  assert.ok(firstOfTwo.endsWith('Hout becomes Hin of block 2.'));
  assert.ok(!firstOfTwo.includes('Digest: '));
  assert.ok(view.worksheetAll(two, twoTraces[1]).endsWith('Digest: ' + nodeHex(utf8(nistTwo.input))));
  assert.ok(view.worksheet(two, twoTraces[1], 63).startsWith('SHA-256 round t=63 (block 2 of 2)'));
});

/* ---- copy and compare ---- */

test('copyFormats builds the four strings from the state values', () => {
  for (const text of ['abc', '', 'a\nb', '\u3042\u{1f600}']) {
    const bytes = utf8(text);
    const result = core.hash(bytes);
    const m = view.copyFormats(result);
    const expected = nodeHex(bytes);
    assert.deepEqual(m, {
      hex64: expected,
      bytesSpaced: core.hexBytes(bytes, ' '),
      bytesJoined: core.hexBytes(bytes, ''),
      sha256sum: expected + '  -'
    });
    assert.equal(m.sha256sum, input.sha256sumLine(expected));
    assert.equal(m.bytesSpaced, input.hexBytes(bytes));
    assert.equal(m.bytesJoined.length, bytes.length * 2);
  }
});

test('compareDigest extracts the 64-digit candidate from shasum, sha256sum, Get-FileHash and certutil output; two or no candidates give null', () => {
  const digest = nodeHex(utf8('abc'));
  const other = nodeHex(utf8('abd'));
  const upper = digest.toUpperCase();
  const pairs = digest.match(/../g).join(' ');
  const certutil = 'SHA256 hash of file.txt:\r\n' + digest + '\r\nCertUtil: -hashfile command completed successfully.\r\n';
  const oldCertutil = 'SHA256 hash of file file.txt:\r\n' + pairs + '\r\nCertUtil: -hashfile command completed successfully.\r\n';
  const getFileHash = 'Algorithm       Hash                                                                   Path\n' +
    '---------       ----                                                                   ----\n' +
    'SHA256          ' + upper + '                       C:\\work\\file.txt\n';
  for (const text of ['SHA256 (file) = ' + upper, digest + '  *file', digest + '  -', certutil, oldCertutil, getFileHash, '  ' + upper + '\n', 'sha256:' + digest, '0x' + digest]) {
    const m = view.compareDigest(text, digest);
    assert.deepEqual(m, { found: [digest], match: true, normalized: digest, expected: digest }, JSON.stringify(text));
  }
  assert.deepEqual(view.compareDigest(upper, upper), { found: [digest], match: true, normalized: digest, expected: digest });
  assert.deepEqual(view.compareDigest(other + '  *file', digest), { found: [other], match: false, normalized: other, expected: digest });

  const twoCandidates = view.compareDigest(digest + '\n' + other, digest);
  assert.deepEqual([twoCandidates.found, twoCandidates.match, twoCandidates.normalized], [[digest, other], null, null]);
  const repeated = view.compareDigest(digest + '\n' + upper + '\n' + pairs, digest);
  assert.deepEqual([repeated.found, repeated.match], [[digest], true]);

  for (const text of ['', 'abc', digest.slice(1), digest + '0', nodeHex(utf8('a')) + nodeHex(utf8('b')), crypto.createHash('sha512').update('abc').digest('hex'), pairs.slice(3), null, undefined]) {
    const m = view.compareDigest(text, digest);
    assert.deepEqual([m.found, m.match, m.normalized], [[], null, null], JSON.stringify(text));
  }
  assert.deepEqual(view.compareDigest(digest, null), { found: [digest], match: null, normalized: digest, expected: null });
  assert.deepEqual(view.compareDigest(digest, 'abc').match, null);
  assert.equal(view.compareDigest(digest + ' ' + digest.slice(0, 63) + 'g', digest).found.length, 1);
});

/* ---- errors ---- */

test('Invalid traces, results and indices are rejected', () => {
  assert.throws(() => view.scheduleModel(abcTrace, 64), RangeError);
  assert.throws(() => view.scheduleModel(abcTrace, -1), RangeError);
  assert.throws(() => view.scheduleModel(abcTrace, 1.5), RangeError);
  assert.throws(() => view.roundModel(abcTrace, 64), RangeError);
  assert.throws(() => view.worksheet(abc, abcTrace, 64), RangeError);
  for (const fn of ['blockModel', 'finalModel']) assert.throws(() => view[fn]({}), TypeError);
  for (const fn of ['paddingModel', 'digestModel', 'droppedStats', 'copyFormats']) assert.throws(() => view[fn](null), TypeError);
  assert.throws(() => view.scheduleModel({ W: new Uint32Array(64) }, 16), TypeError);
  assert.throws(() => view.positionModel({}, 0), TypeError);
  assert.throws(() => view.worksheetAll(abc, {}), TypeError);
});

test('trace-view.js is UMD, exposes the contract, stays ASCII and touches no DOM API', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'trace-view.js'), 'utf8');
  assert.doesNotMatch(source, /[^\x0a\x20-\x7e]/);
  assert.doesNotMatch(source, /\bdocument\b|\bwindow\b|innerHTML|setAttribute|createElement|localStorage|\bfetch\s*\(|Worker\s*\(/);
  assert.match(source, /root\.SHA256ByteView = factory\(root\.SHA256ByteCore\)/);
  assert.ok(Object.isFrozen(view));
  for (const name of ['bits', 'word', 'byteGrid', 'paddingModel', 'blockModel', 'scheduleModel', 'roundModel', 'finalModel',
    'digestModel', 'positionModel', 'droppedStats', 'worksheet', 'worksheetAll', 'copyFormats', 'compareDigest']) {
    assert.equal(typeof view[name], 'function', name);
  }
  assert.equal(view.diffModel, undefined);
});
