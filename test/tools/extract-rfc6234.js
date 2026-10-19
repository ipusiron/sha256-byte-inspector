/* Extracts the byte-oriented SHA-256 test cases of RFC 6234 section 8.5 (the
 * shatest.c test driver printed in test/vectors/rfc6234.txt) into
 * test/vectors/rfc6234-sha256.json.
 *
 * The #define'd test patterns are expanded the way the C preprocessor and
 * compiler would (macro references, adjacent string literals, \xHH escapes) and
 * the expected digests are read from the "SHA256" entry of the hashes[] array.
 * Each JSON entry gives the unit bytes (inputHex) and how many times the unit is
 * fed to the hash (repeat): TEST3 is "a" repeated 1,000,000 times and TEST4 is
 * TEST4a TEST4b (64 bytes) repeated 10 times. Cases 5, 7 and 9 carry extra bits
 * and are bit-oriented, so they are left out. Case 6 is the literal "\x19" in the
 * array itself and is named TEST6 here. Every digest is recomputed with node:crypto.
 * Usage: node test/tools/extract-rfc6234.js */
'use strict';

const assert = require('node:assert/strict');
const support = require('./support.js');

const SOURCE = 'rfc6234.txt';
const TARGET = 'rfc6234-sha256.json';
const PAGE_BREAK = /^(?:Eastlake & Hansen\s+Informational\s+\[Page \d+\]|RFC 6234\s+SHAs, HMAC-SHAs, and HKDF\s+May 2011)$/;
const SIMPLE_ESCAPES = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '\\': 92, '"': 34, "'": 39, '?': 63 };

function sectionLines(text) {
  const lines = support.splitLines(text);
  const start = lines.findIndex(line => /^8\.5\.\s+The Test Driver\s*$/.test(line));
  const end = lines.findIndex((line, index) => index > start && /^9\.\s+Security Considerations/.test(line));
  assert.ok(start >= 0 && end > start, 'Section 8.5 not found');
  return lines.slice(start, end).filter(line => !PAGE_BREAK.test(line.trim()));
}

function collectDefines(lines) {
  const defines = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^#define\s+([A-Za-z_]\w*)(?:\s+(.*))?$/.exec(lines[i]);
    if (!match) continue;
    let body = match[2] || '';
    while (/\\\s*$/.test(body)) {
      i += 1;
      body = body.replace(/\\\s*$/, ' ') + lines[i];
    }
    body = body.replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
    assert.ok(!defines.has(match[1]), 'Macro defined twice: ' + match[1]);
    defines.set(match[1], body);
  }
  return defines;
}

/* Bytes of one C string literal, quotes included. */
function decodeLiteral(literal) {
  assert.match(literal, /^"[\s\S]*"$/, 'Not a string literal: ' + literal);
  const bytes = [];
  const pattern = /\\x([0-9A-Fa-f]{1,2})|\\([0-7]{1,3})|\\(.)|([^\\])/g;
  for (const match of literal.slice(1, -1).matchAll(pattern)) {
    if (match[1] !== undefined) bytes.push(parseInt(match[1], 16));
    else if (match[2] !== undefined) bytes.push(parseInt(match[2], 8));
    else if (match[3] !== undefined) {
      assert.ok(match[3] in SIMPLE_ESCAPES, 'Unknown escape in ' + literal);
      bytes.push(SIMPLE_ESCAPES[match[3]]);
    } else {
      const code = match[4].charCodeAt(0);
      assert.ok(code < 0x80, 'Non-ASCII character in ' + literal);
      bytes.push(code);
    }
  }
  return bytes;
}

/* Bytes of a macro body: string literals are concatenated, identifiers expanded. */
function expand(defines, body, depth = 0) {
  assert.ok(depth < 8, 'Macro nesting too deep');
  const bytes = [];
  for (const match of body.matchAll(/"(?:\\.|[^"\\])*"|[A-Za-z_]\w*/g)) {
    const token = match[0];
    if (token.startsWith('"')) {
      bytes.push(...decodeLiteral(token));
    } else {
      assert.ok(defines.has(token), 'Undefined macro: ' + token);
      bytes.push(...expand(defines, defines.get(token), depth + 1));
    }
  }
  assert.equal(body.replace(/"(?:\\.|[^"\\])*"|[A-Za-z_]\w*/g, '').trim(), '', 'Unexpected text in macro body: ' + body);
  return bytes;
}

function sha256Entries(lines) {
  const text = lines.join('\n');
  const start = text.indexOf('{ "SHA256", SHA256, SHA256HashSize,');
  const end = text.indexOf('{ "SHA384", SHA384, SHA384HashSize,', start);
  assert.ok(start >= 0 && end > start, 'SHA256 entry of hashes[] not found');
  const pattern = /\/\*\s*(\d+)\s*\*\/\s*\{\s*("(?:\\.|[^"\\])*"|[A-Za-z_]\w*)\s*,\s*([^,]+?)\s*,\s*(\d+)\s*,\s*(0x[0-9A-Fa-f]+|\d+)\s*,\s*(\d+)\s*,\s*((?:"[0-9A-Fa-f]*"\s*)+)\}/g;
  const entries = [];
  for (const match of text.slice(start, end).matchAll(pattern)) {
    const digest = match[7].match(/[0-9A-Fa-f]+/g).join('').toLowerCase();
    assert.equal(digest.length, 64, `Case ${match[1]}: digest must be 64 hex digits`);
    entries.push({
      n: Number(match[1]),
      testarray: match[2],
      lengthExpr: match[3].trim(),
      repeat: Number(match[4]),
      extrabits: Number(match[5]),
      numberExtrabits: Number(match[6]),
      digest
    });
  }
  assert.deepEqual(entries.map(entry => entry.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'Ten SHA256 cases');
  return entries;
}

function extract(text) {
  const lines = sectionLines(text);
  const defines = collectDefines(lines);
  const data = [];
  const skipped = [];
  for (const entry of sha256Entries(lines)) {
    if (entry.numberExtrabits !== 0) {
      skipped.push(entry.n);
      continue;
    }
    let name;
    let bytes;
    if (entry.testarray.startsWith('"')) {
      name = 'TEST' + entry.n;
      bytes = decodeLiteral(entry.testarray);
      assert.equal(Number(entry.lengthExpr), bytes.length, `Case ${entry.n}: literal length`);
    } else {
      name = entry.testarray;
      assert.ok(defines.has(name), `Case ${entry.n}: macro ${name} not defined`);
      bytes = expand(defines, defines.get(name));
      const length = /^length\((\w+)\)$/.exec(entry.lengthExpr);
      assert.ok(length && length[1] === name, `Case ${entry.n}: length() must name ${name}`);
    }
    assert.ok(bytes.length > 0 && entry.repeat >= 1, `Case ${entry.n}: empty input`);
    data.push({ n: entry.n, name, inputHex: support.hexOf(bytes), repeat: entry.repeat, digest: entry.digest });
  }
  assert.deepEqual(data.map(entry => entry.n), [1, 2, 3, 4, 6, 8, 10], 'Seven byte-oriented cases');
  for (const entry of data) {
    const unit = Buffer.from(entry.inputHex, 'hex');
    const message = Buffer.alloc(unit.length * entry.repeat).fill(unit);
    assert.equal(support.sha256Hex(message), entry.digest, `${entry.name}: node:crypto digest`);
  }
  return { data, skipped };
}

function main() {
  const { data, skipped } = extract(support.readVector(SOURCE));
  const status = support.emit(TARGET, data, __filename);
  console.log(`${TARGET}: ${status}; ${data.length} byte-oriented cases (bit-oriented cases skipped: ${skipped.join(', ')})`);
  for (const entry of data) {
    console.log(`  #${entry.n} ${entry.name}: ${entry.inputHex.length / 2} bytes x ${entry.repeat}`);
  }
  console.log(`checked with node:crypto: ${data.length}/${data.length}`);
}

module.exports = { extract, collectDefines, decodeLiteral, expand };

if (require.main === module) main();
