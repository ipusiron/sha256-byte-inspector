/* Static checks on app.js (the DOM wiring cannot run under node:test without a
 * browser; the behaviour is probed with Playwright). These tests read the source:
 * every literal t('key', { ... }) call passes exactly the substitution names the
 * dictionary declares, every literal key exists, the storage keys are the two
 * display keys of the contract, the elements it reaches by id exist in index.html,
 * the modules it reads from window are the five UMD globals, and the DOM is built
 * with createElement/textContent only. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const app = read('app.js');
const html = read('index.html');
const messages = require('../messages.js');
const presets = require('../presets.js');

const parameters = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('Literal t() calls with an inline object pass exactly the names the dictionary substitutes', () => {
  const calls = [...app.matchAll(/\bt\(\s*'([\w.-]+)'\s*,\s*\{([^}]*)\}\s*\)/g)];
  assert.ok(calls.length >= 15, String(calls.length));
  for (const [, key, body] of calls) {
    assert.ok(Object.hasOwn(messages.ja, key), key);
    const names = [...body.matchAll(/(?:^|,)\s*(\w+)\s*(?::|,|$)/g)].map(match => match[1]).sort();
    assert.deepEqual(names, parameters(messages.ja[key]), key);
  }
  const plain = [...app.matchAll(/\bt\(\s*'([\w.-]+)'\s*\)/g)].map(match => match[1]);
  assert.ok(plain.length >= 40, String(plain.length));
  for (const key of plain) {
    assert.ok(Object.hasOwn(messages.ja, key), key);
    assert.deepEqual(parameters(messages.ja[key]), [], key + ' needs values');
  }
});

test('Dynamic keys are built from known prefixes only', () => {
  const prefixes = [...app.matchAll(/\bt\(\s*'([\w.-]+\.)'\s*\+/g)].map(match => match[1]);
  assert.ok(prefixes.length >= 5, String(prefixes.length));
  const known = ['preset.group.', 'preset.', 'warning.', 'error.hex.', 'stats.trailing.', 'stats.normalization.', 'cls.', 'dock.match.'];
  for (const prefix of prefixes) assert.ok(known.includes(prefix), prefix);
  for (const status of ['ok', 'ng', 'unknown', 'pending']) assert.ok(Object.hasOwn(messages.ja, 'dock.match.' + status));
  for (const code of ['odd-length', 'invalid-char']) assert.ok(Object.hasOwn(messages.ja, 'error.hex.' + code));
  for (const warning of ['dump-like', 'hash-like', 'lone-surrogate']) assert.ok(Object.hasOwn(messages.ja, 'warning.' + warning));
  for (const phase of ['pad', 'split', 'schedule', 'round', 'final', 'digest']) assert.ok(Object.hasOwn(messages.ja, 'phase.' + phase));
  for (const preset of presets.list) assert.ok(Object.hasOwn(messages.ja, 'preset.' + preset.id));
});

test('Every id that app.js reads exists in index.html', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const used = [...app.matchAll(/\$\(\s*'([\w-]+)'\s*\)/g)].map(match => match[1]);
  assert.ok(used.length > 40, String(used.length));
  const created = ['copy-fallback'];
  for (const id of new Set(used)) assert.ok(ids.has(id) || created.includes(id), '#' + id);
  for (const prefix of ['tab-', 'panel-', 'board-', 'input-mode-']) {
    assert.ok(app.includes("'" + prefix + "'"), prefix + ' is composed from a prefix');
  }
});

test('Storage keys, globals and DOM construction follow the contract', () => {
  const keys = [...app.matchAll(/['"`](sha256-byte-inspector\.[\w.-]*)['"`]/g)].map(match => match[1]).sort();
  assert.deepEqual(keys, ['sha256-byte-inspector.display', 'sha256-byte-inspector.lang']);
  assert.match(app, /JSON\.stringify\(\{ theme: state\.theme, motion: state\.motion \}\)/);
  const globals = [...app.matchAll(/window\.(SHA256\w+)/g)].map(match => match[1]).sort();
  assert.deepEqual(globals, ['SHA256ByteCore', 'SHA256ByteInput', 'SHA256ByteMessages', 'SHA256BytePresets', 'SHA256ByteView']);
  assert.match(app, /document\.createElement\(tag\)/);
  assert.doesNotMatch(app, /innerHTML|outerHTML|insertAdjacentHTML|\.cssText|insertRule|setAttribute\(\s*['"]style['"]/);
  assert.doesNotMatch(app, /[^\x00-\x7f]/, 'ASCII only');
  assert.match(app, /isComposing/, 'IME composition is not hashed');
  assert.match(app, /coloredLimit: COLORED_LIMIT/);
  assert.match(app, /const COLORED_LIMIT = 4096;/);
  assert.match(app, /const BYTE_LIMIT = 65536;/);
  assert.match(app, /const FRAGMENT_LIMIT = 10000;/);
  assert.match(app, /prefers-color-scheme: light/);
  assert.match(app, /prefers-reduced-motion: reduce/);
  assert.match(app, /isSecureContext/);
});
