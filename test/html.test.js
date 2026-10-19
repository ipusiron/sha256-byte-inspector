/* Tests for index.html and the page-level rules of CLAUDE.md: the six deferred
 * scripts, the exact CSP, the ids of the screen contract, the four entrances,
 * the six boards, the link allowlist, the dictionary keys used by data-i18n and
 * the DOM/storage/network rules that app.js must follow. The checks on app.js
 * read the file directly, so they fail until app.js exists. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('index.html');
const css = read('style.css');
const messages = require('../messages.js');

const SCRIPTS = ['sha256-core.js', 'input-core.js', 'presets.js', 'trace-view.js', 'messages.js', 'app.js'];
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; connect-src 'none'";
const REPOSITORY = 'https://github.com/ipusiron/sha256-byte-inspector';
const ENTRANCES = ['guide', 'free', 'learn', 'settings'];
const BOARDS = ['pad', 'split', 'schedule', 'round', 'final', 'digest'];
const PHASES = ['input', 'pad', 'split', 'schedule', 'round', 'final', 'digest'];
const STORAGE_KEYS = ['sha256-byte-inspector.lang', 'sha256-byte-inspector.display', 'sha256-byte-inspector.learning'];
/* Every id named in the "screen contract" section of CLAUDE.md. */
const CONTRACT_IDS = [
  'lang-toggle', 'theme-select', 'motion-toggle',
  'tab-guide', 'tab-free', 'tab-learn', 'tab-settings',
  'panel-guide', 'panel-free', 'panel-learn', 'panel-settings',
  'announcement', 'error',
  'input-mode', 'text-input', 'hex-input', 'newline-select', 'trailing-newline', 'bom-check', 'preset-select',
  'input-stats', 'input-error', 'byte-grid', 'byte-legend',
  'stage-rail', 'position-block', 'position-index',
  'stage', 'board-pad', 'board-split', 'board-schedule', 'board-round', 'board-final', 'board-digest',
  'dock', 'match-badge', 'digest-groups', 'radix-select', 'dropped-stats',
  'copy-hash', 'copy-bytes-spaced', 'copy-bytes-joined', 'copy-sha256sum', 'copy-worksheet',
  'compare-input', 'compare-result',
  'clock', 'clock-first', 'clock-prev', 'clock-play', 'clock-next', 'clock-last', 'clock-range', 'granularity', 'clock-speed'
];

/* The opening tag of the element with the given id. */
function tag(id) {
  const match = new RegExp('<([a-z0-9]+)\\b[^>]*\\bid="' + id + '"[^>]*>').exec(html);
  assert.ok(match, 'element #' + id);
  return { name: match[1], attrs: match[0] };
}

function attribute(attrs, name) {
  const match = new RegExp('\\s' + name + '="([^"]*)"').exec(attrs);
  return match ? match[1] : null;
}

function sliceBetween(startId, endId) {
  const start = html.indexOf('id="' + startId + '"');
  const end = html.indexOf('id="' + endId + '"');
  assert.ok(start >= 0 && end > start, startId + ' before ' + endId);
  return html.slice(start, end);
}

test('Six local classic scripts are deferred in dependency order', () => {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, SCRIPTS.length);
  assert.deepEqual(scripts.map(([, attrs]) => /src="([^"]+)"/.exec(attrs)[1]), SCRIPTS);
  for (const [, attrs, body] of scripts) {
    assert.match(attrs, /\bdefer\b/);
    assert.doesNotMatch(attrs, /type=|async|crossorigin|integrity|nomodule/);
    assert.equal(body.trim(), '');
  }
  assert.doesNotMatch(html, /type="module"|type="file"|<style|<link[^>]*href="https?:|src="https?:|javascript:/);
});

test('Exact restrictive CSP, referrer, local favicon, charset and viewport', () => {
  assert.equal(/http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1], CSP);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.match(html, /<link rel="icon" href="data:,">/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /<link rel="stylesheet" href="style.css">/);
  assert.equal((html.match(/<link\b/g) || []).length, 2);
});

test('Japanese document language, title and a noscript message in both languages', () => {
  assert.match(html, /^<!doctype html>\n<html lang="ja">/);
  assert.match(html, /<title>SHA-256 Byte Inspector<\/title>/);
  const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(html);
  assert.ok(noscript);
  assert.match(noscript[1], /<p lang="ja">[^<]+<\/p>/);
  assert.match(noscript[1], /<p lang="en">Enable JavaScript to use this tool\.<\/p>/);
  assert.equal(noscript[1].match(/<p lang="ja">([^<]+)<\/p>/)[1], messages.ja['noscript.ja']);
});

test('No inline styles, event handler attributes or inline scripts', () => {
  assert.doesNotMatch(html, /\s(?:on\w+|style)\s*=/i);
  assert.doesNotMatch(html, /<script\b[^>]*>[^<]/);
});

test('IDs are unique and every id of the screen contract exists', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size, 'duplicate id');
  for (const id of CONTRACT_IDS) assert.ok(ids.includes(id), 'missing #' + id);
  for (const id of ids) assert.match(id, /^[a-z][a-z0-9-]*$/, id);
});

test('Four entrances are tabs with matching panels, and the learning path opens first', () => {
  const tablist = /<nav class="entries" role="tablist"([^>]*)>([\s\S]*?)<\/nav>/.exec(html);
  assert.ok(tablist);
  assert.match(tablist[1], /data-i18n-label="tabs"/);
  const order = [...tablist[2].matchAll(/id="tab-(\w+)"/g)].map(match => match[1]);
  assert.deepEqual(order, ENTRANCES);
  for (const name of ENTRANCES) {
    const tab = tag('tab-' + name).attrs;
    assert.match(tab, /^<button\b/);
    assert.match(tab, /\btype="button"/);
    assert.match(tab, /\brole="tab"/);
    assert.equal(attribute(tab, 'aria-controls'), 'panel-' + name);
    assert.equal(attribute(tab, 'aria-selected'), name === 'guide' ? 'true' : 'false');
    assert.equal(attribute(tab, 'tabindex'), name === 'guide' ? '0' : '-1');
    const panel = tag('panel-' + name).attrs;
    assert.match(panel, /^<section\b/);
    assert.match(panel, /\brole="tabpanel"/);
    assert.equal(attribute(panel, 'aria-labelledby'), 'tab-' + name);
    assert.equal(/\bhidden\b/.test(panel), name !== 'guide', 'panel-' + name + ' visibility');
  }
  assert.doesNotMatch(html, /<dialog|aria-modal/);
});

test('Live regions: announcement is polite, errors and the match badge are status or alert', () => {
  assert.equal(attribute(tag('announcement').attrs, 'aria-live'), 'polite');
  assert.equal(attribute(tag('announcement').attrs, 'role'), 'status');
  assert.equal(attribute(tag('error').attrs, 'role'), 'alert');
  assert.equal(attribute(tag('input-error').attrs, 'role'), 'alert');
  assert.equal(attribute(tag('match-badge').attrs, 'role'), 'status');
  assert.equal(attribute(tag('compare-result').attrs, 'role'), 'status');
});

test('The stage holds the six boards in order and only the padding board starts visible', () => {
  const stage = sliceBetween('stage', 'dock');
  const boards = [...stage.matchAll(/id="board-(\w+)"/g)].map(match => match[1]);
  assert.deepEqual(boards, BOARDS);
  for (const name of BOARDS) {
    const board = tag('board-' + name).attrs;
    assert.match(board, /^<section\b/);
    assert.equal(attribute(board, 'aria-labelledby'), 'board-' + name + '-title');
    assert.equal(/\bhidden\b/.test(board), name !== 'pad', 'board-' + name + ' visibility');
    assert.ok(tag('board-' + name + '-title').name === 'h3');
  }
});

test('The stage rail has seven phase buttons in order and the position slots', () => {
  const rail = /<nav id="stage-rail"([^>]*)>([\s\S]*?)<\/nav>/.exec(html);
  assert.ok(rail);
  assert.match(rail[1], /data-i18n-label="rail\.title"/);
  const buttons = [...rail[2].matchAll(/<button\b([^>]*)>/g)].map(match => match[1]);
  assert.equal(buttons.length, PHASES.length);
  assert.deepEqual(buttons.map(attrs => attribute(attrs, 'data-phase')), PHASES);
  for (const attrs of buttons) {
    assert.match(attrs, /\btype="button"/);
    assert.equal(attribute(attrs, 'data-i18n'), 'rail.' + attribute(attrs, 'data-phase'));
  }
  assert.equal(tag('position-block').name, 'span');
  assert.equal(tag('position-index').name, 'span');
});

test('Input card: mode radios, two text areas, newline options, two checkboxes and the preset list', () => {
  assert.equal(tag('input-mode').name, 'fieldset');
  const radios = [...sliceBetween('input-mode', 'text-field').matchAll(/<input\b([^>]*)>/g)].map(match => match[1]);
  assert.deepEqual(radios.map(attrs => attribute(attrs, 'value')), ['text', 'hex']);
  for (const attrs of radios) {
    assert.equal(attribute(attrs, 'type'), 'radio');
    assert.equal(attribute(attrs, 'name'), 'input-mode');
  }
  assert.match(radios[0], /\bchecked\b/);
  assert.doesNotMatch(radios[1], /\bchecked\b/);
  for (const id of ['text-input', 'hex-input', 'compare-input']) {
    const area = tag(id);
    assert.equal(area.name, 'textarea', id);
    assert.match(area.attrs, /spellcheck="false"/);
    assert.match(area.attrs, /autocomplete="off"/);
    assert.match(html, new RegExp('<label for="' + id + '"'));
  }
  assert.doesNotMatch(tag('text-input').attrs, /maxlength/);
  assert.equal(tag('newline-select').name, 'select');
  const newline = /<select id="newline-select">([\s\S]*?)<\/select>/.exec(html)[1];
  assert.deepEqual([...newline.matchAll(/value="(\w+)"/g)].map(match => match[1]), ['lf', 'crlf']);
  for (const id of ['trailing-newline', 'bom-check', 'motion-toggle']) {
    const box = tag(id).attrs;
    assert.equal(attribute(box, 'type'), 'checkbox', id);
    assert.doesNotMatch(box, /\bchecked\b/, id + ' starts unchecked');
  }
  const preset = /<select id="preset-select">([\s\S]*?)<\/select>/.exec(html)[1];
  assert.match(preset, /<option value="" data-i18n="input\.preset\.none">/);
  assert.equal(tag('byte-legend').name, 'ul');
});

test('Dock and clock controls expose the contract options', () => {
  const radix = /<select id="radix-select">([\s\S]*?)<\/select>/.exec(html)[1];
  assert.deepEqual([...radix.matchAll(/value="(\w+)"/g)].map(match => match[1]), ['hex', 'bin', 'dec']);
  const theme = /<select id="theme-select">([\s\S]*?)<\/select>/.exec(html)[1];
  assert.deepEqual([...theme.matchAll(/value="(\w+)"/g)].map(match => match[1]), ['dark', 'light']);
  const granularity = /<select id="granularity">([\s\S]*?)<\/select>/.exec(html)[1];
  assert.deepEqual([...granularity.matchAll(/value="(\w+)"/g)].map(match => match[1]), ['step', 'eight', 'phase', 'block']);
  const speed = /<select id="clock-speed">([\s\S]*?)<\/select>/.exec(html)[1];
  const speeds = [...speed.matchAll(/value="([\d.]+)"/g)].map(match => Number(match[1]));
  assert.deepEqual(speeds, [0.25, 0.5, 1, 2, 4, 8]);
  assert.equal((speed.match(/\bselected\b/g) || []).length, 1);
  const range = tag('clock-range').attrs;
  assert.equal(attribute(range, 'type'), 'range');
  for (const name of ['min', 'max', 'step', 'value', 'aria-valuetext']) assert.notEqual(attribute(range, name), null, name);
  for (const id of ['clock-first', 'clock-prev', 'clock-play', 'clock-next', 'clock-last']) {
    const button = tag(id).attrs;
    assert.match(button, /^<button\b/);
    assert.equal(attribute(button, 'data-i18n-label'), 'clock.' + id.slice('clock-'.length));
  }
  assert.equal(attribute(tag('clock-play').attrs, 'aria-pressed'), 'false');
  assert.equal(attribute(tag('clock').attrs, 'data-i18n-label'), 'clock.title');
  assert.ok(sliceBetween('panel-free', 'panel-learn').includes('id="clock"'), 'the clock belongs to the free panel');
  for (const id of ['copy-hash', 'copy-bytes-spaced', 'copy-bytes-joined', 'copy-sha256sum', 'copy-worksheet', 'lang-toggle']) {
    assert.match(tag(id).attrs, /^<button\b[^>]*\btype="button"/, id);
  }
});

test('External links match the allowlist and isolate opened tabs', () => {
  const links = [...html.matchAll(/<a\b([^>]+)>/g)];
  assert.equal(links.length, 1);
  assert.deepEqual(links.map(([, attrs]) => attribute(attrs, 'href')), [REPOSITORY]);
  for (const [, attrs] of links) {
    assert.match(attrs, /rel="noopener noreferrer"/);
    assert.match(attrs, /target="_blank"/);
    assert.equal(attribute(attrs, 'data-i18n'), 'repository');
  }
  assert.deepEqual([...html.matchAll(/https?:\/\/[^\s"'<>]+/g)].map(match => match[0]), [REPOSITORY]);
});

test('Every data-i18n key exists in both dictionaries and takes no substitution', () => {
  const keys = [...html.matchAll(/data-i18n(?:-label)?="([^"]+)"/g)].map(match => match[1]);
  assert.ok(keys.length > 60, String(keys.length));
  for (const key of keys) {
    assert.ok(Object.hasOwn(messages.ja, key), 'ja ' + key);
    assert.ok(Object.hasOwn(messages.en, key), 'en ' + key);
    assert.doesNotMatch(messages.ja[key], /\{\w+\}/, key + ' is static and cannot take values');
  }
  assert.doesNotMatch(html, /data-i18n(?:-label)?=""/);
});

test('The stylesheet hides [hidden] elements regardless of display rules', () => {
  assert.ok(css.replace(/\s/g, '').includes('[hidden]{display:none!important;}'));
});

test('Core modules touch neither the DOM nor the network', () => {
  for (const name of ['sha256-core.js', 'input-core.js', 'presets.js', 'trace-view.js', 'messages.js']) {
    const source = read(name);
    assert.doesNotMatch(source, /\bdocument\.|\bwindow\.|\blocalStorage\b|\bfetch\s*\(|XMLHttpRequest|WebSocket|Worker\s*\(|innerHTML|\beval\s*\(/, name);
    assert.match(source, /typeof module === 'object' && module\.exports/, name + ' is UMD');
  }
});

test('app.js: no unsafe DOM writes, inline styles, networking, workers or persistence beyond the contract', () => {
  const app = read('app.js');
  assert.doesNotMatch(app, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function\b/);
  assert.doesNotMatch(app, /setAttribute\(\s*['"]style['"]|\.cssText\b|insertRule|createElement\(\s*['"]style['"]\)|\.style\s*=\s*['"`]/);
  assert.doesNotMatch(app, /sessionStorage|indexedDB|document\.cookie|\bfetch\s*\(|XMLHttpRequest|WebSocket|Worker\s*\(|sendBeacon|EventSource|serviceWorker|importScripts|\bimport\s*\(/);
  assert.doesNotMatch(app, /location\.(?:hash|href|search|pathname)\s*=|location\.(?:assign|replace|reload)\s*\(|pushState|window\.open\s*\(/);
  assert.deepEqual(app.match(/history\.\w+/g), ['history.replaceState'], 'history is touched once, to clear the fragment');
  assert.doesNotMatch(app, /localStorage\.clear/);
  const literals = [...app.matchAll(/['"`](sha256-byte-inspector\.[\w.-]*)['"`]/g)].map(match => match[1]);
  assert.ok(literals.length >= 1, 'the language key is read from localStorage');
  for (const key of literals) assert.ok(STORAGE_KEYS.includes(key), 'unexpected storage key ' + key);
  assert.doesNotMatch(app, /['"`][\w-]*(?:tamper|hash-chain)[\w.-]*['"`]/i, 'no storage key or id copied from Day117');
  assert.doesNotMatch(app, /[^\x00-\x7f]/, 'no non-ASCII text in app.js');
});
