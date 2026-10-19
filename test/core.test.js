/* Known answers, invariants and the stage model of sha256-core.js.
 *
 * Expected values come from test/vectors (JSON that test/tools extracts from the NIST
 * and RFC originals) or are computed with node:crypto and Web Crypto while the tests
 * run. The hex literals below are the "abc" values that the Day118 design notes name
 * as expectations; each one is also checked against the NIST example JSON or against
 * arithmetic on values from it. The other literals are counts and bit positions
 * (step counts, overflow counts, bit differences), not hash values. A missing vector
 * file fails the test instead of skipping it. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../sha256-core.js');

const VECTORS = path.join(__dirname, 'vectors');
const TWO32 = 2 ** 32;
const SLOW_LIMIT = 10000000;
const NIST_TWO_BLOCK = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';

const encoder = new TextEncoder();
const utf8 = text => encoder.encode(text);
const nodeHex = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hexWords = words => Array.from(words, core.hexWord);
const hexToBytes = hex => Uint8Array.from(Buffer.from(hex, 'hex'));
const randomBytes = length => Uint8Array.from(crypto.randomBytes(length));

function loadVector(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(VECTORS, name), 'utf8'));
  } catch (error) {
    throw new Error(`${name} is missing or unreadable (${error.message}); regenerate it with the script in test/tools`);
  }
}

function readText(name) {
  return fs.readFileSync(path.join(VECTORS, name), 'utf8');
}

/* ---- NIST "SHA-256 Examples with Intermediate Values" ---- */

test('NIST examples: W[0..15], a..h after every round, Hout and the digest match the trace', () => {
  const { samples } = loadVector('nist-sha256-rounds.json');
  assert.equal(samples.length, 2);
  let rounds = 0;
  for (const sample of samples) {
    const bytes = utf8(sample.input);
    assert.equal(core.hexBytes(bytes), sample.inputHex);
    const result = core.hash(bytes);
    assert.equal(result.digestHex, sample.digest, sample.name);
    assert.equal(result.digestHex, nodeHex(bytes));
    assert.equal(result.blocks, sample.blocks.length);
    sample.blocks.forEach((block, b) => {
      const where = `${sample.name} block ${b + 1}`;
      const trace = core.traceBlock(result, b);
      assert.deepEqual(hexWords(trace.Hin), block.Hin, `${where}: Hin`);
      assert.deepEqual(hexWords(trace.words), block.W, `${where}: words`);
      assert.deepEqual(hexWords(trace.W.subarray(0, 16)), block.W, `${where}: W[0..15]`);
      assert.equal(block.rounds.length, 64);
      block.rounds.forEach((round, t) => {
        assert.equal(trace.rounds[t].t, round.t);
        assert.deepEqual(hexWords(trace.rounds[t].after), round.state, `${where}: round ${t}`);
        rounds += 1;
      });
      if (block.Hout) assert.deepEqual(hexWords(trace.Hout), block.Hout, `${where}: Hout`);
    });
  }
  assert.equal(rounds, 192);
});

/* ---- NIST "SHA-2 Additional Test Data" ---- */

/* Hashes `count` copies of one byte without building the whole message: full blocks
 * are compressed from a filled buffer, then the tail is padded by core.pad and its
 * length field is replaced by the length of the whole message (FIPS 180-4 5.1.1). */
function streamedFill(fillByte, count) {
  const CHUNK = 1 << 16;
  const chunk = new Uint8Array(CHUNK).fill(fillByte);
  let state = core.H0;
  let remaining = count;
  while (remaining >= 64) {
    const take = Math.min(remaining - (remaining % 64), CHUNK);
    for (let offset = 0; offset < take; offset += 64) state = core.compress(state, chunk, offset);
    remaining -= take;
  }
  const { padded } = core.pad(chunk.subarray(0, remaining));
  new DataView(padded.buffer, padded.byteOffset, padded.byteLength).setBigUint64(padded.length - 8, BigInt(count) * 8n);
  for (let offset = 0; offset < padded.length; offset += 64) state = core.compress(state, padded, offset);
  return hexWords(state).join('');
}

function nodeStreamedFill(fillByte, count) {
  const hash = crypto.createHash('sha256');
  const chunk = Buffer.alloc(Math.min(count, 1 << 26), fillByte);
  let remaining = count;
  while (remaining > 0) {
    const take = Math.min(remaining, chunk.length);
    hash.update(chunk.subarray(0, take));
    remaining -= take;
  }
  return hash.digest('hex');
}

const additional = loadVector('sha2-additional-sha256.json');
assert.equal(additional.length, 13, 'sha2-additional-sha256.json must hold the 13 SHA-256 entries');

for (const entry of additional) {
  const count = entry.input.hex !== undefined ? entry.input.hex.length / 2 : entry.input.count;
  const slow = count > SLOW_LIMIT;
  const skip = slow && !process.env.SHA256_SLOW ? 'set SHA256_SLOW=1 to hash inputs above 10,000,000 bytes' : false;
  test(`SHA-2 Additional #${entry.n}: ${entry.description}`, { skip }, () => {
    if (entry.input.hex !== undefined) {
      const bytes = hexToBytes(entry.input.hex);
      assert.equal(core.hash(bytes).digestHex, entry.digest);
      assert.equal(nodeHex(bytes), entry.digest);
      return;
    }
    const fillByte = parseInt(entry.input.fill, 16);
    if (!slow) {
      const bytes = new Uint8Array(count).fill(fillByte);
      const result = core.hash(bytes);
      assert.equal(result.digestHex, entry.digest);
      assert.equal(result.blocks, core.blockCount(count));
      assert.equal(nodeHex(bytes), entry.digest);
      assert.equal(streamedFill(fillByte, count), entry.digest);
      return;
    }
    assert.equal(streamedFill(fillByte, count), entry.digest);
    assert.equal(nodeStreamedFill(fillByte, count), entry.digest);
  });
}

/* ---- padding ---- */

test('Padding: block counts and layout for 0, 3, 55, 56, 63, 64, 119 and 120 bytes', () => {
  const expectedBlocks = { 0: 1, 3: 1, 55: 1, 56: 2, 63: 2, 64: 2, 119: 2, 120: 3 };
  for (const n of [0, 3, 55, 56, 63, 64, 119, 120]) {
    const bytes = randomBytes(n);
    const { padded, layout } = core.pad(bytes);
    const blocks = Math.floor((n + 8) / 64) + 1;
    assert.equal(blocks, expectedBlocks[n]);
    assert.equal(layout.blocks, blocks, `${n} bytes`);
    assert.equal(core.blockCount(n), blocks);
    assert.equal(padded.length, blocks * 64);
    assert.deepEqual(padded.slice(0, n), bytes);
    assert.equal(padded[n], 0x80);
    assert.ok(padded.subarray(n + 1, padded.length - 8).every(byte => byte === 0), `${n} bytes: zeros`);
    assert.equal(new DataView(padded.buffer).getBigUint64(padded.length - 8), BigInt(n) * 8n);
    assert.deepEqual(layout, {
      messageEnd: n, oneBit: n, zeroStart: n + 1, zeroEnd: padded.length - 8, lengthStart: padded.length - 8,
      bitLen: n * 8, bitLenHi: 0, bitLenLo: n * 8, blocks
    });
    assert.equal(core.hash(bytes).blocks, blocks);
  }
});

test('Padding of "abc" is 61 62 63 80 00 ... 00 18, the block the NIST example prints', () => {
  const { padded, layout } = core.pad(utf8('abc'));
  const expected = new Uint8Array(64);
  expected.set(utf8('abc'));
  expected[3] = 0x80;
  new DataView(expected.buffer).setBigUint64(56, 24n);
  assert.deepEqual(padded, expected);
  assert.equal(core.hexBytes(padded, ' '), '61 62 63 80' + ' 00'.repeat(52) + ' 00 00 00 00 00 00 00 18');
  assert.deepEqual(layout, {
    messageEnd: 3, oneBit: 3, zeroStart: 4, zeroEnd: 56, lengthStart: 56, bitLen: 24, bitLenHi: 0, bitLenLo: 24, blocks: 1
  });
  const { samples } = loadVector('nist-sha256-rounds.json');
  const one = samples.find(sample => sample.input === 'abc');
  const two = samples.find(sample => sample.input === NIST_TWO_BLOCK);
  assert.ok(one && two, 'both NIST samples are present');
  assert.equal(core.hexBytes(padded), one.blocks[0].W.join(''));
  assert.equal(core.hexBytes(core.pad(utf8(two.input)).padded), two.blocks.map(block => block.W.join('')).join(''));
});

test('Length field is big-endian: 2^29 + 1 bytes give bitLenHi = 1 and bitLenLo = 8', () => {
  const length = 2 ** 29 + 1;
  const { padded, layout } = core.pad(new Uint8Array(length));
  assert.equal(layout.bitLen, 2 ** 32 + 8);
  assert.equal(layout.bitLenHi, 1);
  assert.equal(layout.bitLenLo, 8);
  assert.equal(layout.blocks, Math.floor((length + 8) / 64) + 1);
  assert.deepEqual(Array.from(padded.subarray(padded.length - 8)), [0, 0, 0, 1, 0, 0, 0, 8]);
  assert.equal(new DataView(padded.buffer).getBigUint64(padded.length - 8), BigInt(length) * 8n);
});

/* ---- constants ---- */

test('deriveConstants: square and cube roots of the first primes give H0 and K', () => {
  const derived = core.deriveConstants();
  assert.equal(derived.primes.length, 64);
  assert.deepEqual(derived.primes.slice(0, 8), [2, 3, 5, 7, 11, 13, 17, 19]);
  assert.equal(derived.primes[63], 311);
  for (const p of derived.primes) {
    for (let d = 2; d * d <= p; d += 1) assert.notEqual(p % d, 0, `${p} is prime`);
  }
  assert.deepEqual(derived.H, hexWords(core.H0));
  assert.deepEqual(derived.K, hexWords(core.K));
  assert.equal(derived.H.length + derived.K.length, 72);

  const sqrt2 = core.derivation(2, 'sqrt');
  const cbrt2 = core.derivation(2, 'cbrt');
  assert.equal(sqrt2.fraction, '6a09e667');
  assert.equal(cbrt2.fraction, '428a2f98');
  assert.equal(sqrt2.fraction, core.hexWord(core.H0[0]));
  assert.equal(cbrt2.fraction, core.hexWord(core.K[0]));
  assert.deepEqual([sqrt2.prime, sqrt2.kind, sqrt2.integer], [2, 'sqrt', '1']);
  assert.deepEqual([cbrt2.prime, cbrt2.kind, cbrt2.integer], [2, 'cbrt', '1']);
  assert.match(sqrt2.decimal, /^1\.4142135623/);
  assert.match(cbrt2.decimal, /^1\.2599210498/);
  const r = BigInt(sqrt2.root);
  assert.ok(r * r <= 2n << 64n && (r + 1n) * (r + 1n) > 2n << 64n, 'root is floor(sqrt(2) * 2^32)');
  assert.equal(r & 0xffffffffn, BigInt('0x' + sqrt2.fraction));
  const c = BigInt(cbrt2.root);
  assert.ok(c ** 3n <= 2n << 96n && (c + 1n) ** 3n > 2n << 96n, 'root is floor(cbrt(2) * 2^32)');
  assert.equal(c & 0xffffffffn, BigInt('0x' + cbrt2.fraction));
  for (let i = 0; i < 8; i += 1) assert.equal(core.derivation(derived.primes[i], 'sqrt').fraction, core.hexWord(core.H0[i]));
  for (let i = 0; i < 64; i += 1) assert.equal(core.derivation(derived.primes[i], 'cbrt').fraction, core.hexWord(core.K[i]));
  assert.throws(() => core.derivation(2, 'sqrt3'), /invalidKind/);
  assert.throws(() => core.derivation(1, 'sqrt'), /invalidPrime/);
});

test('H0 and K equal the tables printed in RFC 6234 and the initial hash value of the NIST example', () => {
  const text = readText('rfc6234.txt');
  const words = pattern => {
    const match = pattern.exec(text);
    assert.ok(match, `pattern ${pattern} found in rfc6234.txt`);
    return match[1].match(/0x[0-9A-Fa-f]{8}/g).map(word => word.slice(2).toLowerCase());
  };
  const K = words(/static const uint32_t K\[64\] = \{([\s\S]*?)\};/);
  assert.equal(K.length, 64);
  assert.deepEqual(K, hexWords(core.K));
  const H = words(/SHA256_H0\[[^\]]*\] = \{([\s\S]*?)\};/);
  assert.equal(H.length, 8);
  assert.deepEqual(H, hexWords(core.H0));
  const { samples } = loadVector('nist-sha256-rounds.json');
  for (const sample of samples) assert.deepEqual(sample.blocks[0].Hin, hexWords(core.H0));
});

test('Empty input and "abc": node:crypto, RFC 6234 TEST1 and the CAVP Len = 0 record agree', () => {
  const empty = core.hash(new Uint8Array(0));
  assert.equal(empty.blocks, 1);
  assert.equal(empty.digestHex, nodeHex(new Uint8Array(0)));
  const abc = core.hash(utf8('abc'));
  assert.equal(abc.digestHex, nodeHex(utf8('abc')));
  const rfc = loadVector('rfc6234-sha256.json').find(entry => entry.name === 'TEST1');
  assert.ok(rfc);
  assert.equal(core.hexBytes(abc.bytes), rfc.inputHex);
  assert.equal(abc.digestHex, rfc.digest);
  const short = fs.readFileSync(path.join(VECTORS, 'nist-cavp', 'SHA256ShortMsg.rsp'), 'utf8').split(/\r?\n/);
  const lenZero = short.findIndex(line => /^Len = 0$/.test(line.trim()));
  assert.ok(lenZero >= 0, 'Len = 0 record present');
  const md = /^MD = ([0-9A-Fa-f]{64})$/.exec(short[lenZero + 2].trim());
  assert.ok(md, 'MD follows Len = 0 and Msg');
  assert.equal(empty.digestHex, md[1].toLowerCase());
});

/* ---- invariants ---- */

function checkSum(sum, terms, where) {
  const raw = terms.reduce((total, x) => total + x, 0);
  assert.equal(sum.raw, raw, `${where}: raw`);
  assert.equal(sum.dropped, Math.floor(raw / TWO32), `${where}: dropped`);
  assert.equal(sum.out, raw - sum.dropped * TWO32, `${where}: out`);
  assert.ok(Number.isInteger(sum.out) && sum.out >= 0 && sum.out < TWO32, `${where}: out is a 32-bit word`);
  assert.ok(raw >= 0 && raw < terms.length * TWO32, `${where}: raw range`);
  assert.deepEqual(core.add32(...terms), { raw: sum.raw, dropped: sum.dropped, out: sum.out });
}

function checkTrace(result, trace, b, previous) {
  const where = `block ${b + 1}`;
  assert.equal(trace.index, b);
  assert.deepEqual(trace.block, result.padded.slice(b * 64, b * 64 + 64));
  assert.deepEqual(trace.Hin, result.Hin.slice(8 * b, 8 * b + 8));
  assert.deepEqual(trace.Hout, result.Hin.slice(8 * (b + 1), 8 * (b + 2)));
  assert.deepEqual(trace.Hin, previous ? previous.Hout : core.H0, `${where}: Hin is H0 or the previous Hout`);

  const view = new DataView(trace.block.buffer, trace.block.byteOffset, trace.block.byteLength);
  assert.equal(trace.words.length, 16);
  assert.equal(trace.W.length, 64);
  for (let t = 0; t < 16; t += 1) {
    assert.equal(trace.words[t], view.getUint32(t * 4), `${where}: word ${t}`);
    assert.equal(trace.W[t], trace.words[t]);
  }

  assert.equal(trace.schedule.length, 48);
  trace.schedule.forEach((entry, i) => {
    const t = i + 16;
    const label = `${where} W[${t}]`;
    assert.equal(entry.t, t);
    assert.equal(entry.x15, trace.W[t - 15]);
    assert.equal(entry.x2, trace.W[t - 2]);
    assert.deepEqual(entry.s0, { rotr7: core.rotr(entry.x15, 7), rotr18: core.rotr(entry.x15, 18), shr3: core.shr(entry.x15, 3), out: core.sigma0(entry.x15) });
    assert.equal(entry.s0.out, (entry.s0.rotr7 ^ entry.s0.rotr18 ^ entry.s0.shr3) >>> 0);
    assert.deepEqual(entry.s1, { rotr17: core.rotr(entry.x2, 17), rotr19: core.rotr(entry.x2, 19), shr10: core.shr(entry.x2, 10), out: core.sigma1(entry.x2) });
    assert.equal(entry.s1.out, (entry.s1.rotr17 ^ entry.s1.rotr19 ^ entry.s1.shr10) >>> 0);
    assert.deepEqual(entry.terms, [trace.W[t - 16], entry.s0.out, trace.W[t - 7], entry.s1.out]);
    checkSum(entry, entry.terms, label);
    assert.equal(entry.out, trace.W[t], label);
    assert.ok(entry.dropped <= 3);
  });

  assert.equal(trace.rounds.length, 64);
  trace.rounds.forEach((round, t) => {
    const label = `${where} round ${t}`;
    assert.equal(round.t, t);
    assert.equal(round.K, core.K[t]);
    assert.equal(round.W, trace.W[t]);
    assert.deepEqual(round.before, t === 0 ? trace.Hin : trace.rounds[t - 1].after, `${label}: before`);
    const [a, b2, c, d, e, f, g, h] = round.before;
    assert.deepEqual(round.S1, { rotr6: core.rotr(e, 6), rotr11: core.rotr(e, 11), rotr25: core.rotr(e, 25), out: core.Sigma1(e) });
    assert.equal(round.ch, core.ch(e, f, g));
    assert.deepEqual(round.S0, { rotr2: core.rotr(a, 2), rotr13: core.rotr(a, 13), rotr22: core.rotr(a, 22), out: core.Sigma0(a) });
    assert.equal(round.maj, core.maj(a, b2, c));
    assert.deepEqual(round.T1.terms, [h, round.S1.out, round.ch, core.K[t], trace.W[t]]);
    checkSum(round.T1, round.T1.terms, `${label} T1`);
    assert.ok(round.T1.dropped <= 4);
    assert.deepEqual(round.T2.terms, [round.S0.out, round.maj]);
    checkSum(round.T2, round.T2.terms, `${label} T2`);
    assert.ok(round.T2.dropped <= 1);
    checkSum(round.e, [d, round.T1.out], `${label} e`);
    checkSum(round.a, [round.T1.out, round.T2.out], `${label} a`);
    assert.deepEqual(round.after, Uint32Array.from([round.a.out, a, b2, c, round.e.out, e, f, g]), `${label}: after`);
  });

  assert.equal(trace.final.length, 8);
  trace.final.forEach((lane, i) => {
    assert.equal(lane.i, i);
    assert.equal(lane.h, trace.Hin[i]);
    assert.equal(lane.v, trace.rounds[63].after[i]);
    checkSum(lane, [lane.h, lane.v], `${where} H[${i}]`);
    assert.equal(lane.out, trace.Hout[i]);
  });
}

test('Invariants: schedule, round recurrence, final addition and block chaining for "abc", the 56-byte example and random inputs', () => {
  const inputs = [utf8('abc'), utf8(NIST_TWO_BLOCK)];
  for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 200, 1000]) inputs.push(randomBytes(n));
  let blocks = 0;
  for (const bytes of inputs) {
    const result = core.hash(bytes);
    assert.equal(result.bytes, bytes);
    assert.equal(result.digestHex, nodeHex(bytes));
    assert.equal(result.Hin.length, 8 * (result.blocks + 1));
    assert.deepEqual(result.Hin.slice(0, 8), core.H0);
    let previous = null;
    for (let b = 0; b < result.blocks; b += 1) {
      const trace = core.traceBlock(result, b);
      checkTrace(result, trace, b, previous);
      previous = trace;
      blocks += 1;
    }
    assert.deepEqual(result.Hin.slice(8 * result.blocks), previous.Hout);
    assert.equal(result.digest.length, 32);
    assert.equal(core.hexBytes(result.digest), result.digestHex);
    assert.equal(hexWords(previous.Hout).join(''), result.digestHex);
    assert.throws(() => core.traceBlock(result, result.blocks), /invalidBlock/);
    assert.throws(() => core.traceBlock(result, -1), /invalidBlock/);
  }
  assert.ok(blocks >= 24);
});

test('compress is pure and equals the block transitions of hash', () => {
  const bytes = randomBytes(200);
  const result = core.hash(bytes);
  for (let b = 0; b < result.blocks; b += 1) {
    const Hin = result.Hin.slice(8 * b, 8 * b + 8);
    const copy = Uint32Array.from(Hin);
    assert.deepEqual(core.compress(Hin, result.padded, b * 64), result.Hin.slice(8 * (b + 1), 8 * (b + 2)));
    assert.deepEqual(core.compress(Hin, result.padded.slice(b * 64, b * 64 + 64)), result.Hin.slice(8 * (b + 1), 8 * (b + 2)));
    assert.deepEqual(Hin, copy);
  }
  assert.throws(() => core.compress(core.H0, new Uint8Array(63)), /invalidBlock/);
  assert.throws(() => core.compress(core.H0, new Uint8Array(64), 1), /invalidBlock/);
});

/* ---- Web Crypto ---- */

test('Web Crypto: 200 random inputs of 0 to 300 bytes match crypto.subtle.digest', async () => {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  assert.ok(subtle, 'globalThis.crypto.subtle is required');
  for (let i = 0; i < 200; i += 1) {
    const length = i === 0 ? 0 : i === 1 ? 300 : crypto.randomInt(0, 301);
    const bytes = randomBytes(length);
    const expected = Buffer.from(await subtle.digest('SHA-256', bytes)).toString('hex');
    assert.equal(core.hash(bytes).digestHex, expected, `${length} bytes`);
    assert.equal(nodeHex(bytes), expected);
  }
});

/* ---- step model ---- */

test('Step model: 1 + blocks x (1 + 48 + 64 + 1) + 1 steps, ids round-trip for every step', () => {
  /* The contract lists the steps as the padding, then per block one split, 48
   * schedule words (W[16..63]), 64 rounds and one final addition, then the digest.
   * That is 116 for one block (the design notes quote 117, 232 and 1,842, which do
   * not follow from that list). */
  assert.equal(core.stepCount(1), 116);
  assert.equal(core.stepCount(2), 230);
  assert.equal(core.stepCount(16), 1826);
  for (const blocks of [1, 2, 3, 16]) {
    const total = core.stepCount(blocks);
    assert.equal(total, 1 + blocks * 114 + 1);
    const ids = new Set();
    const phases = {};
    for (let k = 0; k < total; k += 1) {
      const position = core.stepAt(blocks, k);
      const id = core.positionId(position);
      assert.ok(!ids.has(id), `${id} is unique`);
      ids.add(id);
      assert.deepEqual(core.parsePositionId(id), position, id);
      assert.equal(core.stepOf(blocks, position), k, id);
      assert.equal(core.stepOf(blocks, core.parsePositionId(id)), k, id);
      phases[position.phase] = (phases[position.phase] || 0) + 1;
    }
    assert.equal(ids.size, total);
    assert.deepEqual(phases, { pad: 1, split: blocks, schedule: 48 * blocks, round: 64 * blocks, final: blocks, digest: 1 });
    assert.deepEqual(core.stepAt(blocks, 0), { phase: 'pad', block: 0, index: 0 });
    assert.deepEqual(core.stepAt(blocks, 1), { phase: 'split', block: 0, index: 0 });
    assert.deepEqual(core.stepAt(blocks, 2), { phase: 'schedule', block: 0, index: 16 });
    assert.deepEqual(core.stepAt(blocks, 49), { phase: 'schedule', block: 0, index: 63 });
    assert.deepEqual(core.stepAt(blocks, 50), { phase: 'round', block: 0, index: 0 });
    assert.deepEqual(core.stepAt(blocks, 113), { phase: 'round', block: 0, index: 63 });
    assert.deepEqual(core.stepAt(blocks, 114), { phase: 'final', block: 0, index: 0 });
    if (blocks > 1) assert.deepEqual(core.stepAt(blocks, 115), { phase: 'split', block: 1, index: 0 });
    assert.deepEqual(core.stepAt(blocks, total - 1), { phase: 'digest', block: null, index: 0 });
    assert.equal(core.positionId(core.stepAt(blocks, 0)), 'b1.pad');
    assert.equal(core.positionId(core.stepAt(blocks, 1)), 'b1.split');
    assert.equal(core.positionId(core.stepAt(blocks, 2)), 'b1.w16');
    assert.equal(core.positionId(core.stepAt(blocks, 114)), 'b1.add');
    assert.equal(core.positionId(core.stepAt(blocks, total - 2)), `b${blocks}.add`);
    assert.equal(core.positionId(core.stepAt(blocks, total - 1)), 'out');
    assert.throws(() => core.stepAt(blocks, total), /invalidStep/);
    assert.throws(() => core.stepAt(blocks, -1), /invalidStep/);
    assert.throws(() => core.stepOf(blocks, { phase: 'round', block: blocks, index: 0 }), /invalidPosition/);
  }
  assert.equal(core.positionId({ phase: 'round', block: 0, index: 51 }), 'b1.r51');
  assert.equal(core.stepOf(1, core.parsePositionId('b1.r51')), 1 + 1 + 48 + 51);
  assert.deepEqual(core.parsePositionId('b2.w63'), { phase: 'schedule', block: 1, index: 63 });
  for (const bad of ['', 'b0.pad', 'b2.pad', 'b1.w15', 'b1.w64', 'b1.r64', 'b1.r05', 'b01.split', 'B1.r1', 'b1.r1 ', ' out', 'b1.x', 'b1', 'out.b1', 42, null, undefined]) {
    assert.equal(core.parsePositionId(bad), null, String(bad));
  }
  assert.throws(() => core.stepCount(0), /invalidBlocks/);
  assert.throws(() => core.positionId({ phase: 'schedule', block: 0, index: 15 }), /invalidPosition/);
  assert.throws(() => core.positionId({ phase: 'round', block: 0, index: 64 }), /invalidPosition/);
  assert.throws(() => core.positionId({ phase: 'later', block: 0, index: 0 }), /invalidPosition/);
});

/* ---- differences ---- */

test('Difference: "abc" vs "abb" spreads to 3, 26, 60, 84 and 107 bits in rounds 0 to 4 and 124 digest bits', () => {
  const A = core.hash(utf8('abc'));
  const B = core.hash(utf8('abb'));
  assert.deepEqual(core.diffBytes(A.bytes, B.bytes), [2]);
  assert.equal(core.popcount(A.bytes[2] ^ B.bytes[2]), 1);
  const diff = core.diffTrace(core.traceBlock(A, 0), core.traceBlock(B, 0));
  assert.equal(diff.W.length, 64);
  assert.equal(diff.rounds.length, 64);
  assert.deepEqual(diff.W.slice(0, 16), [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([diff.W[16], diff.W[18], diff.W[20], diff.W[22]], [1, 2, 4, 10]);
  assert.deepEqual(diff.rounds.slice(0, 5), [3, 26, 60, 84, 107]);
  assert.ok(diff.rounds.slice(5).every(bits => bits >= 105 && bits <= 146), 'later rounds stay between 105 and 146 of 256 bits');
  assert.equal(diff.final, 124);
  assert.equal(diff.final, core.diffWords(A.Hin.subarray(8), B.Hin.subarray(8)));
  let digestBits = 0;
  for (let i = 0; i < 32; i += 1) digestBits += core.popcount(A.digest[i] ^ B.digest[i]);
  assert.equal(digestBits, 124);
  assert.deepEqual(core.diffTrace(core.traceBlock(A, 0), core.traceBlock(A, 0)), { W: new Array(64).fill(0), rounds: new Array(64).fill(0), final: 0 });
});

test('Difference: "abc" vs "abc" + LF differ in padded bytes 3, 4 and 63 and in 128 digest bits', () => {
  const A = core.hash(utf8('abc'));
  const B = core.hash(utf8('abc\n'));
  assert.equal(A.blocks, 1);
  assert.equal(B.blocks, 1);
  assert.deepEqual(core.diffBytes(A.padded, B.padded), [3, 4, 63]);
  assert.deepEqual(core.diffBytes(A.bytes, B.bytes), [3]);
  const diff = core.diffTrace(core.traceBlock(A, 0), core.traceBlock(B, 0));
  assert.deepEqual(diff.rounds.slice(0, 5), [10, 36, 67, 108, 130]);
  assert.equal(diff.final, 128);
});

/* ---- the "abc" highlights ---- */

test('"abc" highlights: W[16] = W[0], W[17] = 000f0000, schedule overflows from t = 27 (35 of 48), round 0 sums, final lanes 1, 3, 5, 115 of 256 carries', () => {
  const result = core.hash(utf8('abc'));
  const trace = core.traceBlock(result, 0);
  const sample = loadVector('nist-sha256-rounds.json').samples.find(entry => entry.input === 'abc');
  assert.ok(sample);
  const block = sample.blocks[0];

  assert.equal(trace.W[16], trace.W[0]);
  assert.equal(core.hexWord(trace.W[16]), '61626380');
  assert.equal(core.hexWord(trace.W[16]), block.W[0]);
  assert.deepEqual(trace.schedule[0].terms, [trace.W[0], 0, 0, 0]);
  assert.equal(core.hexWord(trace.W[17]), '000f0000');
  assert.equal(trace.W[17], core.sigma1(trace.W[15]));
  assert.equal(trace.W[17], core.sigma1(parseInt(block.W[15], 16)));
  assert.equal(core.popcount(trace.W[15]), 2);
  assert.equal(core.popcount(trace.W[17]), 4);

  const overflowed = trace.schedule.filter(entry => entry.dropped > 0);
  assert.equal(overflowed[0].t, 27);
  assert.equal(overflowed.length, 35);
  assert.ok(trace.schedule.filter(entry => entry.t < 27).every(entry => entry.dropped === 0));

  const r0 = trace.rounds[0];
  assert.deepEqual(r0.T1.terms, [core.H0[7], core.Sigma1(core.H0[4]), core.ch(core.H0[4], core.H0[5], core.H0[6]), core.K[0], trace.W[0]]);
  assert.equal(r0.T1.raw, 0x154da50e8);
  assert.equal(r0.T1.raw, 5718561000);
  assert.equal(r0.T1.dropped, 1);
  assert.equal(core.hexWord(r0.T1.out), '54da50e8');
  assert.equal(r0.T2.dropped, 1);
  assert.equal(core.hexWord(r0.T2.out), '08909ae5');
  assert.equal(core.hexWord(r0.after[0]), '5d6aebcd');
  assert.equal(core.hexWord(r0.after[4]), 'fa2a4622');
  /* The NIST text prints a..h after round 0, not T1 and T2; e = d + T1 and a = T1 + T2 give them. */
  assert.equal(core.hexWord(r0.after[0]), block.rounds[0].state[0]);
  assert.equal(core.hexWord(r0.after[4]), block.rounds[0].state[4]);
  const printedT1 = (parseInt(block.rounds[0].state[4], 16) - parseInt(block.Hin[3], 16) + TWO32) % TWO32;
  const printedT2 = (parseInt(block.rounds[0].state[0], 16) - printedT1 + TWO32) % TWO32;
  assert.equal(r0.T1.out, printedT1);
  assert.equal(r0.T2.out, printedT2);

  assert.deepEqual(trace.final.filter(lane => lane.dropped > 0).map(lane => lane.i), [1, 3, 5]);
  assert.deepEqual(hexWords(trace.Hout), block.Hout);

  /* Sequential carries: the five T1 terms are added left to right, reducing mod 2^32
   * after each of the 4 additions (256 additions in 64 rounds); a carry is an
   * intermediate sum that reaches 2^32. Their number equals the sum of T1.dropped. */
  let carries = 0;
  let droppedSum = 0;
  let additions = 0;
  for (const round of trace.rounds) {
    let running = round.T1.terms[0];
    for (let i = 1; i < round.T1.terms.length; i += 1) {
      running += round.T1.terms[i];
      additions += 1;
      if (running >= TWO32) {
        carries += 1;
        running -= TWO32;
      }
    }
    assert.equal(running, round.T1.out);
    droppedSum += round.T1.dropped;
  }
  assert.equal(additions, 256);
  assert.equal(carries, 115);
  assert.equal(droppedSum, 115);
});

/* ---- small helpers ---- */

test('Bit operations, add32, popcount and formatting', () => {
  assert.equal(core.rotr(1, 1), 0x80000000);
  assert.equal(core.rotr(0x80000000, 31), 1);
  assert.equal(core.rotr(0x12345678, 8), 0x78123456);
  assert.equal(core.shr(0x80000000, 31), 1);
  assert.equal(core.shr(0xffffffff, 4), 0x0fffffff);
  assert.equal(core.ch(0xf0f0f0f0, 0xffffffff, 0), 0xf0f0f0f0);
  assert.equal(core.ch(0xf0f0f0f0, 0, 0xffffffff), 0x0f0f0f0f);
  assert.equal(core.maj(0xffffffff, 0xffffffff, 0), 0xffffffff);
  assert.equal(core.maj(0xffffffff, 0, 0), 0);
  assert.equal(core.maj(0xf0f0f0f0, 0xff00ff00, 0x0f0f0f0f), 0xff00ff00);
  for (let i = 0; i < 1000; i += 1) {
    const x = crypto.randomInt(0, TWO32);
    assert.equal(core.sigma0(x), (core.rotr(x, 7) ^ core.rotr(x, 18) ^ core.shr(x, 3)) >>> 0);
    assert.equal(core.sigma1(x), (core.rotr(x, 17) ^ core.rotr(x, 19) ^ core.shr(x, 10)) >>> 0);
    assert.equal(core.Sigma0(x), (core.rotr(x, 2) ^ core.rotr(x, 13) ^ core.rotr(x, 22)) >>> 0);
    assert.equal(core.Sigma1(x), (core.rotr(x, 6) ^ core.rotr(x, 11) ^ core.rotr(x, 25)) >>> 0);
    assert.equal(core.popcount(x), x.toString(2).split('1').length - 1);
    assert.equal(core.hexWord(x), x.toString(16).padStart(8, '0'));
    assert.equal(core.bin32(x), x.toString(2).padStart(32, '0'));
    assert.equal(parseInt(core.bin32(x), 2), x);
  }
  assert.deepEqual(core.add32(0xffffffff, 1), { raw: TWO32, dropped: 1, out: 0 });
  assert.deepEqual(core.add32(0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff), { raw: 5 * TWO32 - 5, dropped: 4, out: 0xfffffffb });
  assert.deepEqual(core.add32(), { raw: 0, dropped: 0, out: 0 });
  assert.deepEqual(core.add32(7), { raw: 7, dropped: 0, out: 7 });
  assert.equal(core.popcount(0), 0);
  assert.equal(core.popcount(0xffffffff), 32);
  assert.equal(core.diffWords(Uint32Array.from([0, 0xffffffff]), Uint32Array.from([0xffffffff, 0])), 64);
  assert.equal(core.diffWords([], []), 0);
  assert.throws(() => core.diffWords([0], [0, 0]), /lengthMismatch/);
  assert.deepEqual(core.diffBytes(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 0, 3, 4])), [1, 3]);
  assert.deepEqual(core.diffBytes(new Uint8Array(0), new Uint8Array(0)), []);
  assert.equal(core.hexBytes(Uint8Array.from([0, 15, 255])), '000fff');
  assert.equal(core.hexBytes(Uint8Array.from([0, 15, 255]), ' '), '00 0f ff');
  assert.equal(core.hexBytes(Uint8Array.from([0, 15, 255]), ':'), '00:0f:ff');
  assert.equal(core.hexBytes(new Uint8Array(0)), '');
  assert.equal(core.hexWord(0), '00000000');
  assert.equal(core.hexWord(-1), 'ffffffff');
  assert.equal(core.bin32(1), '0'.repeat(31) + '1');
});

test('hash accepts byte containers and rejects anything else', () => {
  const bytes = randomBytes(70);
  const expected = nodeHex(bytes);
  assert.equal(core.hash(bytes).digestHex, expected);
  assert.equal(core.hash(Buffer.from(bytes)).digestHex, expected);
  assert.equal(core.hash(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).digestHex, expected);
  assert.equal(core.hash(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)).digestHex, expected);
  assert.equal(core.hash(Array.from(bytes)).digestHex, expected);
  const offset = new Uint8Array(100);
  offset.set(bytes, 20);
  assert.equal(core.hash(offset.subarray(20, 90)).digestHex, expected);
  for (const bad of ['abc', 123, null, undefined, {}, [256], [-1], [1.5]]) {
    assert.throws(() => core.hash(bad), /bytesRequired/, String(bad));
    assert.throws(() => core.pad(bad), /bytesRequired/, String(bad));
  }
  assert.throws(() => core.traceBlock(null, 0), /resultRequired/);
  assert.throws(() => core.blockCount(-1), /invalidLength/);
});
