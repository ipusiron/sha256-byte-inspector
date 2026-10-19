/* Builds test/vectors/day117-inputs.json: the exact strings that Day117 Hash Chain
 * Tamper Trainer hashes for its "access" sample, so the inspector can show their
 * bytes and arrive at the same values.
 *
 * Day117's rules (chain-core.js): the seed is SHA-256 of the header lines joined
 * by LF; each row hashes "<previous hash>|<fields joined by commas>"; the trailer
 * hashes "<last hash>|rows=<row count>"; with the headers left out the seed is
 * 64 zeros. Headers and rows are read from Day117's samples.js when a checkout is
 * found (../../day117/hash-chain-tamper-trainer, or the path given as the first
 * argument) and compared with the copy in day117-chain-vectors.json, which is used
 * on its own otherwise. Expected values come from day117-chain-vectors.json where
 * that file has them and are recomputed with node:crypto in every case.
 * Usage: node test/tools/extract-day117-inputs.js [path-to-day117-checkout] */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const support = require('./support.js');

const VECTORS = 'day117-chain-vectors.json';
const TARGET = 'day117-inputs.json';
const SAMPLE = 'access';
const FIXED_SEED = '0'.repeat(64);
const CHANGED_TIME = ['09:05', '09:06'];

const sha256 = text => support.sha256Hex(Buffer.from(text, 'utf8'));

function loadDay117Sample(dir) {
  const file = path.join(dir, 'samples.js');
  if (!fs.existsSync(file)) return null;
  const samples = require(file);
  const sample = samples.find(entry => entry.id === SAMPLE);
  assert.ok(sample, `samples.js has no sample "${SAMPLE}"`);
  return { headers: sample.headers, rows: sample.rows };
}

/* Recomputes every value of day117-chain-vectors.json; returns the number checked. */
function checkVectors(vectors) {
  let checked = 0;
  for (const vector of vectors) {
    let previous = sha256(vector.headers.join('\n'));
    assert.equal(previous, vector.seed, `${vector.id}: seed`);
    checked += 1;
    vector.rows.forEach((row, index) => {
      previous = sha256(previous + '|' + row.join(','));
      assert.equal(previous, vector.hashes[index], `${vector.id}: row ${index + 1}`);
      checked += 1;
    });
    assert.equal(sha256(previous + '|rows=' + vector.rows.length), vector.trailer, `${vector.id}: trailer`);
    checked += 1;
  }
  return checked;
}

function build(vectors, sample) {
  const vector = vectors.find(entry => entry.id === SAMPLE);
  assert.ok(vector, `${VECTORS} has no sample "${SAMPLE}"`);
  const { headers, rows } = sample || vector;
  if (sample) {
    assert.deepEqual(headers, vector.headers, 'Day117 headers differ from day117-chain-vectors.json');
    assert.deepEqual(rows, vector.rows, 'Day117 rows differ from day117-chain-vectors.json');
  }
  assert.ok(rows.length >= 2, 'The sample needs at least two rows');
  assert.equal(rows[1][0], CHANGED_TIME[0], 'The second row no longer starts at ' + CHANGED_TIME[0]);

  const entries = [];
  const push = (name, input, known) => {
    const expected = sha256(input);
    if (known !== undefined) assert.equal(expected, known, `${name}: ${VECTORS} value`);
    entries.push({ name, input, expected });
    return expected;
  };
  const seed = push(`${SAMPLE}-seed`, headers.join('\n'), vector.seed);
  const first = push(`${SAMPLE}-row1`, seed + '|' + rows[0].join(','), vector.hashes[0]);
  const changedRow = [CHANGED_TIME[1], ...rows[1].slice(1)];
  const changed = push(`${SAMPLE}-row2-time-changed`, first + '|' + changedRow.join(','));
  assert.notEqual(changed, vector.hashes[1], 'Changing the time must change the hash');
  push(`${SAMPLE}-trailer`, vector.hashes[vector.hashes.length - 1] + '|rows=' + rows.length, vector.trailer);
  push(`${SAMPLE}-row1-fixed-seed`, FIXED_SEED + '|' + rows[0].join(','));
  return entries;
}

function main() {
  const vectors = JSON.parse(support.readVector(VECTORS));
  const day117Dir = process.argv[2] || path.join(__dirname, '..', '..', '..', '..', 'day117', 'hash-chain-tamper-trainer');
  const sample = loadDay117Sample(day117Dir);
  const checked = checkVectors(vectors);
  const data = build(vectors, sample);
  const status = support.emit(TARGET, data, __filename);
  console.log(`${TARGET}: ${status}; ${data.length} inputs (headers and rows from ${sample ? 'Day117 samples.js' : VECTORS})`);
  const known = data.filter(entry => [vectors.find(v => v.id === SAMPLE)].some(v => v.seed === entry.expected || v.hashes.includes(entry.expected) || v.trailer === entry.expected)).length;
  console.log(`checked with node:crypto: ${data.length}/${data.length} inputs (${known} also present in ${VECTORS}); ${VECTORS}: ${checked}/${checked} values recomputed`);
}

module.exports = { build, checkVectors, loadDay117Sample };

if (require.main === module) main();
