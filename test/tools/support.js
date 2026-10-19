/* Shared helpers for the extraction scripts in test/tools.
 *
 * The scripts read the original vector files in test/vectors as data (no line of
 * them is ever executed) and write the derived JSON next to them. Node's test
 * runner (`node --test`) executes every file under test/, including these
 * scripts; in that case a script only checks that the committed JSON is current
 * and never writes a file. */
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VECTORS = path.join(__dirname, '..', 'vectors');
const ARRAY_INLINE_LIMIT = 400;
const OBJECT_INLINE_LIMIT = 200;

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function hexOf(bytes) {
  return Buffer.from(bytes).toString('hex');
}

/* Form feeds (page breaks left by pdftotext) are dropped; CRLF and LF both end a line. */
function splitLines(text) {
  return String(text).replace(/\f/g, '').split(/\r?\n/);
}

function readVector(name) {
  return fs.readFileSync(path.join(VECTORS, name), 'utf8');
}

function underTestRunner() {
  return Boolean(process.env.NODE_TEST_CONTEXT);
}

function isPrimitive(value) {
  return value === null || typeof value !== 'object';
}

/* JSON with two-space indentation where short arrays and flat objects stay on one line. */
function formatJson(value, indent = '') {
  const inner = indent + '  ';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every(isPrimitive)) {
      const line = '[' + value.map(item => JSON.stringify(item)).join(', ') + ']';
      if (line.length <= ARRAY_INLINE_LIMIT) return line;
    }
    return '[\n' + value.map(item => inner + formatJson(item, inner)).join(',\n') + '\n' + indent + ']';
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    const parts = keys.map(key => JSON.stringify(key) + ': ' + formatJson(value[key], inner));
    const line = '{' + parts.join(', ') + '}';
    if (line.length <= OBJECT_INLINE_LIMIT && !parts.some(part => part.includes('\n'))) return line;
    return '{\n' + parts.map(part => inner + part).join(',\n') + '\n' + indent + '}';
  }
  return JSON.stringify(value);
}

/* Writes test/vectors/<name>, or under the test runner only verifies that the
 * committed file equals what the script extracts now. Returns a status word. */
function emit(name, data, script) {
  const target = path.join(VECTORS, name);
  const text = formatJson(data) + '\n';
  assert.deepEqual(JSON.parse(text), data, 'formatJson must round-trip');
  let existing = null;
  try {
    existing = fs.readFileSync(target, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (existing !== null && existing.replace(/\r\n/g, '\n') === text) return 'unchanged';
  if (underTestRunner()) {
    const command = 'node ' + path.relative(path.join(VECTORS, '..', '..'), script).split(path.sep).join('/');
    throw new Error(`${name} is ${existing === null ? 'missing' : 'out of date'}; regenerate it with: ${command}`);
  }
  fs.writeFileSync(target, text);
  return existing === null ? 'created' : 'updated';
}

module.exports = { VECTORS, sha256Hex, hexOf, splitLines, readVector, underTestRunner, formatJson, emit };
