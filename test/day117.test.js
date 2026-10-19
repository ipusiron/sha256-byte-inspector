/* Day117 Hash Chain Tamper Trainer reproduced with the pure JavaScript core.
 * day117-inputs.json holds the exact strings Day117 hashes for its "access" sample
 * (made by test/tools/extract-day117-inputs.js); day117-chain-vectors.json is Day117's
 * own known-answer file. Day117's rules: seed = SHA-256 of the header lines joined
 * by LF; row = SHA-256 of "<previous hash>|<fields joined by commas>"; trailer =
 * SHA-256 of "<last hash>|rows=<count>". Strings become bytes with TextEncoder. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../sha256-core.js');

const VECTORS = path.join(__dirname, 'vectors');
const encoder = new TextEncoder();
const utf8 = text => encoder.encode(text);
const digestHexOf = text => core.hash(utf8(text)).digestHex;
const nodeHex = text => crypto.createHash('sha256').update(utf8(text)).digest('hex');

function loadVector(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(VECTORS, name), 'utf8'));
  } catch (error) {
    throw new Error(`${name} is missing or unreadable (${error.message})`);
  }
}

const inputs = loadVector('day117-inputs.json');
const vectors = loadVector('day117-chain-vectors.json');

test('Day117 inputs: the five "access" strings hash to the recorded values', () => {
  assert.equal(inputs.length, 5);
  assert.deepEqual(inputs.map(entry => entry.name), ['access-seed', 'access-row1', 'access-row2-time-changed', 'access-trailer', 'access-row1-fixed-seed']);
  for (const { name, input, expected } of inputs) {
    const bytes = utf8(input);
    const result = core.hash(bytes);
    assert.equal(result.digestHex, expected, name);
    assert.equal(nodeHex(input), expected, name);
    assert.equal(result.blocks, core.blockCount(bytes.length));
  }
  const byName = Object.fromEntries(inputs.map(entry => [entry.name, entry]));
  assert.equal(utf8(byName['access-seed'].input).length, 55);
  assert.equal(utf8(byName['access-row1'].input).length, 87);
  assert.equal(utf8(byName['access-row2-time-changed'].input).length, 87);
  assert.equal(utf8(byName['access-trailer'].input).length, 71);
  assert.equal(utf8(byName['access-row1-fixed-seed'].input).length, 87);
  assert.equal(core.hash(utf8(byName['access-seed'].input)).blocks, 1);
  assert.equal(core.hash(utf8(byName['access-row1'].input)).blocks, 2);
  /* The row hashes chain through their hex strings, 64 bytes of text, not 32 raw bytes. */
  assert.equal(byName['access-row1'].input.slice(0, 64), byName['access-seed'].expected);
  assert.equal(byName['access-row1'].input[64], '|');
  assert.equal(byName['access-row2-time-changed'].input.slice(0, 64), byName['access-row1'].expected);
  assert.equal(byName['access-row1-fixed-seed'].input.slice(0, 64), '0'.repeat(64));
});

for (const vector of vectors) {
  test(`Day117 chain "${vector.id}": seed, ${vector.rows.length} rows and trailer recomputed from the rules`, () => {
    const seedInput = vector.headers.join('\n');
    let previous = digestHexOf(seedInput);
    assert.equal(previous, vector.seed);
    assert.equal(nodeHex(seedInput), vector.seed);
    assert.notEqual(digestHexOf(vector.headers.join('\r\n')), vector.seed, 'CRLF between the headers changes the seed');
    assert.notEqual(digestHexOf(seedInput + '\n'), vector.seed, 'a trailing LF changes the seed');
    vector.rows.forEach((row, index) => {
      const input = previous + '|' + row.join(',');
      previous = digestHexOf(input);
      assert.equal(previous, vector.hashes[index], `${vector.id} row ${index + 1}`);
      assert.equal(nodeHex(input), vector.hashes[index]);
    });
    assert.equal(vector.hashes.length, vector.rows.length);
    const trailerInput = previous + '|rows=' + vector.rows.length;
    assert.equal(digestHexOf(trailerInput), vector.trailer);
    assert.equal(nodeHex(trailerInput), vector.trailer);
  });
}

test('Day117 presets build the same five inputs and hashes', () => {
  const presets = require('../presets.js');
  assert.equal(typeof presets.day117.build, 'function', 'presets.day117.build(digestHexOf)');
  const built = presets.day117.build(digestHexOf);
  const byName = Object.fromEntries(inputs.map(entry => [entry.name, entry]));
  assert.equal(built.seed, byName['access-seed'].input);
  assert.equal(built.row1, byName['access-row1'].input);
  assert.equal(built.row2modified, byName['access-row2-time-changed'].input);
  assert.equal(built.trailer, byName['access-trailer'].input);
  assert.equal(built.noHeaderRow1, byName['access-row1-fixed-seed'].input);
  const access = vectors.find(vector => vector.id === 'access');
  assert.ok(access);
  assert.equal(built.hashes.seed, access.seed);
  assert.deepEqual(built.hashes.rows, access.hashes);
  assert.deepEqual(presets.day117.headers, access.headers);
  assert.deepEqual(presets.day117.rows, access.rows);
});
