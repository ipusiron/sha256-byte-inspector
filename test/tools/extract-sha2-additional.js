/* Extracts the "SHA-256 Test Data" section of NIST "SHA-2 Additional Test Data"
 * (test/vectors/sha2-additional.txt, a pdftotext rendering of SHA2_Additional.pdf)
 * into test/vectors/sha2-additional-sha256.json.
 *
 * Inputs are described, not expanded: {"hex": "bd"} is a literal byte string and
 * {"fill": "5a", "count": n} means n copies of one byte. The description text is
 * kept as printed. Entries up to 1,000,000 bytes are recomputed with node:crypto
 * on every run; the three entries of 0.5 to 1.6 GB only when SHA256_SLOW=1 is set.
 * Usage: node test/tools/extract-sha2-additional.js   (SHA256_SLOW=1 checks all 13) */
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const support = require('./support.js');

const SOURCE = 'sha2-additional.txt';
const TARGET = 'sha2-additional-sha256.json';
const SLOW_LIMIT = 1000000;
const CHUNK = 64 * 1024 * 1024;

function describeInput(description) {
  let match = /^(\d+) bytes? 0x([0-9a-f]+)$/.exec(description);
  if (match) {
    assert.equal(match[2].length, Number(match[1]) * 2, 'Byte count and hex length disagree: ' + description);
    return { hex: match[2] };
  }
  match = /^(?:0x([0-9a-f]+) \((\d+)\)|(\d+)) bytes of (?:(zeros)|0x([0-9a-f]{2})(?: `(.)')?)$/.exec(description);
  if (match) {
    const count = Number(match[2] !== undefined ? match[2] : match[3]);
    if (match[1] !== undefined) assert.equal(parseInt(match[1], 16), count, 'Hex and decimal counts disagree: ' + description);
    const fill = match[4] ? '00' : match[5];
    if (match[6] !== undefined) assert.equal(match[6].charCodeAt(0), parseInt(fill, 16), 'Quoted character differs from the byte: ' + description);
    return { fill, count };
  }
  return assert.fail('Unrecognised input description: ' + description);
}

function parse(text) {
  const lines = support.splitLines(text).map(line => line.trim());
  const start = lines.indexOf('SHA-256 Test Data');
  const end = lines.indexOf('SHA-384 Test Data', start + 1);
  assert.ok(start >= 0 && end > start, 'SHA-256 Test Data section not found');
  const entries = [];
  let current = null;
  for (const line of lines.slice(start + 1, end)) {
    if (line === '' || /^=+$/.test(line)) continue;
    const head = /^#(\d+)\)\s+(.+)$/.exec(line);
    if (head) {
      current = { n: Number(head[1]), description: head[2].trim(), words: [] };
      entries.push(current);
      continue;
    }
    if (current && /^(?:[0-9a-f]{8}\s*)+$/.test(line)) {
      current.words.push(...line.split(/\s+/));
      continue;
    }
    assert.fail('Unexpected line in SHA-256 Test Data: ' + line);
  }
  assert.equal(entries.length, 13, 'The section lists 13 entries');
  return entries.map((entry, index) => {
    assert.equal(entry.n, index + 1, 'Entries are numbered consecutively');
    assert.equal(entry.words.length, 8, `#${entry.n}: digest must be eight words`);
    return { n: entry.n, description: entry.description, input: describeInput(entry.description), digest: entry.words.join('') };
  });
}

function byteCount(input) {
  return input.hex !== undefined ? input.hex.length / 2 : input.count;
}

function digestOf(input) {
  if (input.hex !== undefined) return support.sha256Hex(Buffer.from(input.hex, 'hex'));
  const hash = crypto.createHash('sha256');
  const chunk = Buffer.alloc(Math.min(input.count, CHUNK), parseInt(input.fill, 16));
  for (let left = input.count; left > 0; left -= chunk.length) {
    hash.update(left >= chunk.length ? chunk : chunk.subarray(0, left));
  }
  return hash.digest('hex');
}

function check(entries, slow) {
  const checked = [];
  const skipped = [];
  for (const entry of entries) {
    if (byteCount(entry.input) > SLOW_LIMIT && !slow) {
      skipped.push(entry.n);
      continue;
    }
    assert.equal(digestOf(entry.input), entry.digest, `#${entry.n} ${entry.description}: node:crypto digest`);
    checked.push(entry.n);
  }
  return { checked, skipped };
}

function extract(text, slow) {
  const data = parse(text);
  return { data, counts: check(data, slow) };
}

function main() {
  const slow = Boolean(process.env.SHA256_SLOW);
  const { data, counts } = extract(support.readVector(SOURCE), slow);
  const status = support.emit(TARGET, data, __filename);
  console.log(`${TARGET}: ${status}; ${data.length} entries`);
  console.log(`checked with node:crypto: ${counts.checked.length}/${data.length}` +
    (counts.skipped.length ? `; skipped without SHA256_SLOW=1: #${counts.skipped.join(', #')}` : ''));
}

module.exports = { extract, parse, describeInput, digestOf };

if (require.main === module) main();
