/* Static checks on app.js (the DOM wiring cannot run under node:test without a
 * browser; the behaviour is probed with Playwright). These tests read the source:
 * every literal t('key', { ... }) call passes exactly the substitution names the
 * dictionary declares, every literal key exists, the storage keys are the language
 * and the display (theme only), the elements it reaches by id exist in index.html,
 * the modules it reads from window are the five UMD globals, the single page has
 * no tab, panel, dock or motion handling, and the DOM is built with
 * createElement/textContent only. */
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
  assert.ok(plain.includes('copy.fallback'), 'the fallback field is labelled from the dictionary');
  assert.ok(plain.includes('result.match.ng'), 'a Web Crypto mismatch is reported in the error line');
});

test('Dynamic keys are built from known prefixes only', () => {
  const prefixes = [...app.matchAll(/\bt\(\s*'([\w.-]+\.)'\s*\+/g)].map(match => match[1]);
  assert.ok(prefixes.length >= 5, String(prefixes.length));
  const known = ['preset.group.', 'preset.', 'warning.', 'error.hex.', 'stats.trailing.', 'stats.normalization.', 'cls.', 'result.match.'];
  for (const prefix of prefixes) assert.ok(known.includes(prefix), prefix);
  for (const status of ['ok', 'ng', 'unknown', 'pending']) assert.ok(Object.hasOwn(messages.ja, 'result.match.' + status));
  for (const code of ['odd-length', 'invalid-char']) assert.ok(Object.hasOwn(messages.ja, 'error.hex.' + code));
  for (const warning of ['dump-like', 'hash-like', 'lone-surrogate']) assert.ok(Object.hasOwn(messages.ja, 'warning.' + warning));
  for (const phase of ['pad', 'split', 'schedule', 'round', 'final', 'digest']) assert.ok(Object.hasOwn(messages.ja, 'phase.' + phase));
  for (const preset of presets.list) assert.ok(Object.hasOwn(messages.ja, 'preset.' + preset.id));
  /* The bytes heading is one of two keys, set as a whole string (not a prefix). */
  assert.match(app, /const bytesKey = hex \? 'section\.bytesHex' : 'section\.bytes';/);
  assert.match(app, /bytesTitle\.dataset\.i18n = bytesKey;\s*bytesTitle\.textContent = t\(bytesKey\);/);
});

test('Every id that app.js reads exists in index.html; no tab or panel id is composed', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const used = [...app.matchAll(/\$\(\s*'([\w-]+)'\s*\)/g)].map(match => match[1]);
  assert.ok(used.length > 40, String(used.length));
  const created = ['copy-fallback'];
  for (const id of new Set(used)) assert.ok(ids.has(id) || created.includes(id), '#' + id);
  for (const prefix of ['board-', 'input-mode-']) {
    assert.ok(app.includes("'" + prefix + "'"), prefix + ' is composed from a prefix');
  }
  for (const gone of ["'tab-'", "'panel-'", 'motion-toggle', "'dock'", 'free-main', 'free-columns']) assert.ok(!app.includes(gone), gone + ' is gone');
  for (const id of ['input-title', 'bytes-title-text', 'stage-rail', 'digest-groups', 'radix-select', 'match-badge', 'dropped-stats', 'compare-input', 'clock']) {
    assert.ok(used.includes(id), '#' + id + ' is reached by id');
  }
});

test('No tabs, panels or motion setting: the page is one column and reduced motion is left to CSS', () => {
  assert.doesNotMatch(app, /TABS|showTab|wireTabs|state\.active|role="tab"|aria-selected|tabpanel/);
  assert.doesNotMatch(app, /state\.motion|motion-toggle|data-motion|dataset\.motion|settings\.motion/);
  assert.doesNotMatch(app, /dock|--dock-offset|dock-offset|free-main|free-columns|sticky/i);
  assert.doesNotMatch(app, /prefers-reduced-motion/, 'style.css handles the OS setting');
  assert.match(app, /prefers-color-scheme: light/);
  assert.match(app, /JSON\.stringify\(\{ theme: state\.theme \}\)/, 'the display setting holds the theme only');
  assert.doesNotMatch(app, /\bt\(\s*'(?:tab|guide|learn|settings|dock)\./);
});

test('The round header buttons switch theme and language; the output section is rendered from the state', () => {
  assert.doesNotMatch(app, /theme-select/);
  assert.match(app, /\$\('theme-toggle'\)\.addEventListener\('click'/);
  assert.match(app, /\$\('lang-toggle'\)\.addEventListener\('click'/);
  for (const key of ['theme.toLight', 'theme.toDark']) assert.ok(app.includes("'" + key + "'"), key);
  /* SVG elements have no `hidden` IDL property: `svg.hidden = true` is a plain expando. */
  assert.match(app, /querySelector\('\.icon-sun'\)\.toggleAttribute\('hidden', !dark\)/);
  assert.match(app, /querySelector\('\.icon-moon'\)\.toggleAttribute\('hidden', dark\)/);
  assert.doesNotMatch(app, /\.icon-(?:sun|moon)'\)\.hidden/);
  assert.match(app, /dataset\.i18nLabel = dark \? 'theme\.toLight' : 'theme\.toDark'/);
  assert.match(app, /if \(element\.classList\.contains\('icon-button'\)\) element\.title = text;/, 'icon buttons get a title');
  assert.match(app, /querySelectorAll\('\[data-i18n-label\]'\)\.forEach\(labelElement\)/);
  /* The language switch redraws from the state and keeps input, position and digest. */
  assert.match(app, /language = language === 'ja' \? 'en' : 'ja';\s*writeStorage\(LANG_KEY, language\);\s*localize\(\);\s*render\(\);/);
  assert.match(app, /function renderResult\(\)/);
  assert.match(app, /badge\.textContent = has \? t\('result\.match\.' \+ state\.cryptoStatus\) : '';/);
  assert.match(app, /\$\('result'\)\.querySelector\('\.result-note'\)\.hidden = !\(ok && state\.result\.bytes\.length === 0\)/);
  assert.match(app, /const COPY_IDS = \['copy-hash', 'copy-bytes-spaced', 'copy-bytes-joined', 'copy-sha256sum'\];/);
  assert.match(app, /for \(const id of COPY_IDS\) \$\(id\)\.disabled = !ok;/);
  /* The radix select applies to the boards' tiles and to the digest of the output. */
  assert.match(app, /\$\('radix-select'\)\.addEventListener\('change', \(\) => \{\s*const value = \$\('radix-select'\)\.value;\s*state\.radix = RADIXES\.includes\(value\) \? value : 'hex';\s*renderStage\(\);\s*renderResult\(\);\s*\}\);/);
  assert.match(app, /groups\.dataset\.radix = state\.radix;/);
  assert.match(app, /if \(state\.radix === 'bin'\) return w\.bin\.replace/, 'binary digests show 32 digits per word');
  /* The clipboard fallback field is created right after the copy buttons. */
  assert.match(app, /\$\('result'\)\.querySelector\('\.result-actions'\)\.after\(area\);/);
  assert.doesNotMatch(app, /dock\.digest|settings\.theme/);
});

test('The clock height is measured into --clock-height at start-up and on resize', () => {
  assert.match(app, /const CLOCK_MARGIN = 8;/);
  assert.match(app, /const height = \$\('clock'\)\.offsetHeight;\s*if \(height === 0\) return;\s*document\.documentElement\.style\.setProperty\('--clock-height', \(height \+ CLOCK_MARGIN\) \+ 'px'\);/);
  assert.match(app, /window\.addEventListener\('resize', scheduleLayout\);/);
  assert.match(app, /updateClockHeight\(\);\s*\}\s*perform\(init\);/, 'measured once init has drawn the page');
  assert.deepEqual([...app.matchAll(/style\.setProperty\(\s*'([^']+)'/g)].map(match => match[1]), ['--clock-height'], 'the only CSSOM write');
  assert.match(app, /matches\('\(max-width: 767px\)'\)\) \$\('clock'\)\.classList\.add\('is-hidden'\)/, 'the clock hides while a text area has focus on phones');
});

test('Storage keys, globals and DOM construction follow the contract', () => {
  const keys = [...app.matchAll(/['"`](sha256-byte-inspector\.[\w.-]*)['"`]/g)].map(match => match[1]).sort();
  assert.deepEqual(keys, ['sha256-byte-inspector.display', 'sha256-byte-inspector.lang']);
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
  assert.match(app, /isSecureContext/);
  /* The fragment keeps its contract: text or hex input, position, radix, language, compare. */
  assert.match(app, /fragment\.m === 'x' \? fragment\.hex : fragment\.text/);
  assert.match(app, /core\.parsePositionId\(fragment\.at\)/);
  assert.match(app, /RADIXES\.includes\(fragment\.r\)/);
  assert.match(app, /fragment \? fragment\.l : null/);
  assert.match(app, /typeof fragment\.d === 'string'/);
});
