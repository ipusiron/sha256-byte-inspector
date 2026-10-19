/* RFC 6234 section 8.5 byte-oriented SHA-256 cases (test/vectors/rfc6234-sha256.json,
 * extracted from rfc6234.txt by test/tools/extract-rfc6234.js). Each entry repeats a
 * unit of bytes `repeat` times; TEST3 is "a" one million times. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../sha256-core.js');

const FILE = path.join(__dirname, 'vectors', 'rfc6234-sha256.json');
const nodeHex = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function loadEntries() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (error) {
    throw new Error(`rfc6234-sha256.json is missing or unreadable (${error.message}); regenerate it with node test/tools/extract-rfc6234.js`);
  }
}

function build(entry) {
  const unit = Uint8Array.from(Buffer.from(entry.inputHex, 'hex'));
  const bytes = new Uint8Array(unit.length * entry.repeat);
  for (let r = 0; r < entry.repeat; r += 1) bytes.set(unit, r * unit.length);
  return bytes;
}

const entries = loadEntries();

test('RFC 6234 has the seven byte-oriented cases 1, 2, 3, 4, 6, 8 and 10', () => {
  assert.deepEqual(entries.map(entry => entry.n), [1, 2, 3, 4, 6, 8, 10]);
  assert.deepEqual(entries.map(entry => entry.name), ['TEST1', 'TEST2_1', 'TEST3', 'TEST4', 'TEST6', 'TEST8_256', 'TEST10_256']);
  const lengths = Object.fromEntries(entries.map(entry => [entry.name, build(entry).length]));
  assert.deepEqual(lengths, { TEST1: 3, TEST2_1: 56, TEST3: 1000000, TEST4: 640, TEST6: 1, TEST8_256: 16, TEST10_256: 163 });
});

for (const entry of entries) {
  test(`RFC 6234 ${entry.name} (#${entry.n}): ${entry.inputHex.length / 2} bytes x ${entry.repeat}`, () => {
    const bytes = build(entry);
    const result = core.hash(bytes);
    assert.equal(result.digestHex, entry.digest);
    assert.equal(result.blocks, core.blockCount(bytes.length));
    assert.equal(nodeHex(bytes), entry.digest);
    if (entry.name === 'TEST4') assert.equal(result.blocks, 11, '640 bytes of message need 11 blocks after padding');
    if (entry.name === 'TEST2_1') assert.equal(result.blocks, 2, '56 bytes already need a second block');
  });
}
