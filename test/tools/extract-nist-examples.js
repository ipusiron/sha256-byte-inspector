/* Extracts NIST "SHA-256 Examples with Intermediate Values"
 * (test/vectors/nist-sha256-examples.txt, a pdftotext rendering of SHA256.pdf)
 * into test/vectors/nist-sha256-rounds.json.
 *
 * For each sample ("abc" and the 56-byte two-block message) the output holds the
 * input, its digest and, per block, the initial hash value H[0..7] (Hin), the
 * block words W[0..15], the working variables a..h after each of the 64 rounds
 * (rounds[t].state) and the output hash value (Hout). Every value is copied from
 * the text; nothing is computed except for the checks below:
 *   - the digest of each input is recomputed with node:crypto,
 *   - W[0..15] of each block equals the padded message (FIPS 180-4 5.1.1, 5.2.1),
 *   - b, c, d, f, g, h of round t equal a, b, c, e, f, g of round t - 1,
 *   - Hout[i] = (Hin[i] + a..h after round 63) mod 2^32 as printed, and the Hin of
 *     a second block equals the Hout of the first.
 * Usage: node test/tools/extract-nist-examples.js */
'use strict';

const assert = require('node:assert/strict');
const support = require('./support.js');

const SOURCE = 'nist-sha256-examples.txt';
const TARGET = 'nist-sha256-rounds.json';
const WORD = '[0-9A-F]{8}';
const WORD_ONLY = new RegExp(`^${WORD}$`);
const INITIAL = new RegExp(`^H\\[([0-7])\\] = (${WORD})$`);
const BLOCK_WORD = new RegExp(`^W\\[(\\d+)\\] = (${WORD})$`);
const ROUND = new RegExp(`^t=\\s*(\\d+):\\s*((?:${WORD}\\s+){7}${WORD})$`);
const FINAL = new RegExp(`^H\\[([0-7])\\] = (${WORD}) \\+ (${WORD}) = (${WORD})$`);
const QUOTED = /^"([^"]*)"$/;

const lower = words => words.map(word => word.toLowerCase());
const add32 = (a, b) => ((parseInt(a, 16) + parseInt(b, 16)) % 0x100000000).toString(16).padStart(8, '0').toUpperCase();

/* FIPS 180-4 5.1.1 padding for a byte-aligned message, used only to check W[0..15]. */
function pad(bytes) {
  const blocks = Math.floor((bytes.length + 8) / 64) + 1;
  const padded = Buffer.alloc(blocks * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  padded.writeBigUInt64BE(BigInt(bytes.length) * 8n, padded.length - 8);
  return padded;
}

function parse(text) {
  const samples = [];
  let heading = null;
  let sample = null;
  let block = null;
  let initial = null;
  let mode = null;
  for (const raw of support.splitLines(text)) {
    const line = raw.trim();
    if (mode === 'input') {
      if (line === '') continue;
      const quoted = QUOTED.exec(line);
      assert.ok(quoted, 'Input Message must be followed by a quoted string: ' + line);
      sample.input = quoted[1];
      mode = null;
      continue;
    }
    if (mode === 'digest') {
      if (line === '') continue;
      const words = line.split(/\s+/);
      assert.ok(words.every(word => WORD_ONLY.test(word)), 'Unexpected line in Message Digest: ' + line);
      sample.digestWords.push(...words);
      if (sample.digestWords.length >= 8) mode = null;
      continue;
    }
    if (/Message Sample$/.test(line)) {
      heading = line;
      continue;
    }
    if (line.startsWith('Input Message:')) {
      sample = { name: heading || `Sample ${samples.length + 1}`, input: null, blocks: [], digestWords: [] };
      samples.push(sample);
      heading = null;
      block = null;
      const rest = line.slice('Input Message:'.length).trim();
      if (rest === '') {
        mode = 'input';
      } else {
        const quoted = QUOTED.exec(rest);
        assert.ok(quoted, 'Input Message must be a quoted string: ' + line);
        sample.input = quoted[1];
      }
      continue;
    }
    if (line === 'Initial hash value:') {
      initial = [];
      continue;
    }
    if (line === 'Block Contents:') {
      assert.ok(sample, 'Block Contents before any Input Message');
      const previous = block;
      let hin = initial;
      if (previous) {
        assert.equal(previous.final.length, 8, 'A block ended before its eight H[i] additions');
        if (hin) assert.deepEqual(hin, previous.final.map(entry => entry.out));
        else hin = previous.final.map(entry => entry.out);
      }
      assert.ok(hin && hin.length === 8, 'Block Contents without an initial hash value');
      block = { Hin: hin, W: [], rounds: [], final: [] };
      sample.blocks.push(block);
      initial = null;
      continue;
    }
    if (line === 'Message Digest is') {
      assert.ok(sample);
      mode = 'digest';
      continue;
    }
    let match;
    if ((match = INITIAL.exec(line))) {
      assert.ok(initial, 'H[i] value outside "Initial hash value"');
      initial[Number(match[1])] = match[2];
    } else if ((match = BLOCK_WORD.exec(line))) {
      assert.ok(block, 'W[t] outside a block');
      block.W[Number(match[1])] = match[2];
    } else if ((match = ROUND.exec(line))) {
      assert.ok(block, 'Round line outside a block');
      block.rounds.push({ t: Number(match[1]), state: match[2].split(/\s+/) });
    } else if ((match = FINAL.exec(line))) {
      assert.ok(block, 'H[i] addition outside a block');
      block.final[Number(match[1])] = { h: match[2], v: match[3], out: match[4] };
    }
  }
  assert.equal(mode, null, 'The text ended inside a multi-line value');
  return samples;
}

function check(samples) {
  const counts = { samples: samples.length, blocks: 0, rounds: 0, words: 0, additions: 0, digests: 0 };
  assert.equal(samples.length, 2, 'The document has two samples');
  for (const sample of samples) {
    assert.ok(typeof sample.input === 'string', `${sample.name}: no input`);
    assert.equal(sample.digestWords.length, 8, `${sample.name}: digest must be eight words`);
    assert.ok(sample.blocks.length >= 1, `${sample.name}: no blocks`);
    const padded = pad(Buffer.from(sample.input, 'utf8'));
    assert.equal(sample.blocks.length, padded.length / 64, `${sample.name}: block count`);
    sample.blocks.forEach((block, index) => {
      const where = `${sample.name} block ${index + 1}`;
      assert.equal(block.Hin.filter(Boolean).length, 8, `${where}: Hin`);
      assert.equal(block.W.filter(Boolean).length, 16, `${where}: W[0..15]`);
      assert.equal(block.rounds.length, 64, `${where}: 64 rounds`);
      assert.equal(block.final.filter(Boolean).length, 8, `${where}: eight additions`);
      block.W.forEach((word, t) => {
        assert.equal(word, padded.readUInt32BE(index * 64 + t * 4).toString(16).padStart(8, '0').toUpperCase(), `${where}: W[${t}]`);
        counts.words += 1;
      });
      block.rounds.forEach((round, t) => {
        assert.equal(round.t, t, `${where}: round order`);
        const before = t === 0 ? block.Hin : block.rounds[t - 1].state;
        for (const [to, from] of [[1, 0], [2, 1], [3, 2], [5, 4], [6, 5], [7, 6]]) {
          assert.equal(round.state[to], before[from], `${where}: round ${t} shift of variable ${to}`);
        }
        counts.rounds += 1;
      });
      block.final.forEach((entry, i) => {
        assert.equal(entry.h, block.Hin[i], `${where}: addend H[${i}]`);
        assert.equal(entry.v, block.rounds[63].state[i], `${where}: addend from round 63 for H[${i}]`);
        assert.equal(entry.out, add32(entry.h, entry.v), `${where}: sum H[${i}]`);
        counts.additions += 1;
      });
      block.Hout = block.final.map(entry => entry.out);
      if (index > 0) assert.deepEqual(block.Hin, sample.blocks[index - 1].Hout, `${where}: Hin is the previous Hout`);
      counts.blocks += 1;
    });
    const digest = sample.digestWords.join('').toLowerCase();
    assert.equal(digest, sample.blocks[sample.blocks.length - 1].Hout.join('').toLowerCase(), `${sample.name}: digest is the last Hout`);
    assert.equal(digest, support.sha256Hex(Buffer.from(sample.input, 'utf8')), `${sample.name}: node:crypto digest`);
    sample.digest = digest;
    counts.digests += 1;
  }
  return counts;
}

function extract(text) {
  const samples = parse(text);
  const counts = check(samples);
  const data = {
    samples: samples.map(sample => ({
      name: sample.name,
      input: sample.input,
      inputHex: support.hexOf(Buffer.from(sample.input, 'utf8')),
      digest: sample.digest,
      blocks: sample.blocks.map(block => ({
        Hin: lower(block.Hin),
        W: lower(block.W),
        rounds: block.rounds.map(round => ({ t: round.t, state: lower(round.state) })),
        Hout: lower(block.Hout)
      }))
    }))
  };
  return { data, counts };
}

function main() {
  const { data, counts } = extract(support.readVector(SOURCE));
  const status = support.emit(TARGET, data, __filename);
  console.log(`${TARGET}: ${status}; ${counts.samples} samples, ${counts.blocks} blocks, ${counts.rounds} rounds`);
  console.log(`checked with node:crypto: ${counts.digests}/${counts.samples} digests; block words ${counts.words}, round shifts ${counts.rounds}, final additions ${counts.additions}`);
}

module.exports = { extract, parse, pad };

if (require.main === module) main();
