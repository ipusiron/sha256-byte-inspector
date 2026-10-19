/* Tests for index.html and the page-level rules of CLAUDE.md: the six deferred
 * scripts, the exact CSP, the ids of the screen contract, the single page with
 * its five numbered sections in document order (no entrances, panels or dock),
 * the six boards, the fixed clock at the end of main, the link allowlist, the
 * dictionary keys used by data-i18n and the DOM/storage/network rules that
 * app.js must follow. */
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
const BOARDS = ['pad', 'split', 'schedule', 'round', 'final', 'digest'];
const PHASES = ['input', 'pad', 'split', 'schedule', 'round', 'final', 'digest'];
const STORAGE_KEYS = ['sha256-byte-inspector.lang', 'sha256-byte-inspector.display'];
/* The five sections of the page, in reading order, with their heading id and key. */
const SECTIONS = [
  { id: 'input-card', title: 'input-title', key: 'section.input' },
  { id: 'input-options', title: 'input-options-title', key: 'section.options' },
  { id: 'bytes', title: 'bytes-title', key: 'section.bytes' },
  { id: 'compute', title: 'compute-title', key: 'section.compute' },
  { id: 'result', title: 'result-title', key: 'section.result' }
];
/* Every id named in the "screen contract" section of CLAUDE.md. */
const CONTRACT_IDS = [
  'lang-toggle', 'theme-toggle',
  'announcement', 'error',
  'input-card', 'input-title', 'input-mode', 'input-mode-text', 'input-mode-hex', 'text-field', 'text-input', 'hex-field', 'hex-input', 'input-error', 'preset-select',
  'input-options', 'input-options-title', 'newline-select', 'trailing-newline', 'bom-check', 'text-notes',
  'bytes', 'bytes-title', 'bytes-title-text', 'input-stats', 'byte-grid', 'byte-legend',
  'compute', 'compute-title', 'stage-rail', 'position-block', 'position-index',
  'stage', 'stage-title', 'board-pad', 'board-split', 'board-schedule', 'board-round', 'board-final', 'board-digest', 'dropped-stats',
  'result', 'result-title', 'match-badge', 'digest-groups', 'radix-select',
  'copy-hash', 'copy-bytes-spaced', 'copy-bytes-joined', 'copy-sha256sum', 'copy-worksheet',
  'compare-input', 'compare-result',
  'clock', 'clock-first', 'clock-prev', 'clock-play', 'clock-next', 'clock-last', 'clock-range', 'granularity', 'clock-speed'
];
/* Attributes every static inline SVG icon carries, and the ones it must not. */
const SVG_ATTRIBUTES = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' };

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

function inOrder(ids) {
  const positions = ids.map(id => html.indexOf('id="' + id + '"'));
  assert.ok(positions.every(position => position >= 0), 'every id exists: ' + ids.join(' '));
  assert.deepEqual(positions.slice().sort((a, b) => a - b), positions, 'document order ' + ids.join(' < '));
}

const main = /<main>([\s\S]*?)<\/main>/.exec(html);

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

test('One page: no entrances, tabs, panels, dock, settings panel or motion toggle', () => {
  assert.doesNotMatch(html, /class="entries"|role="tab|aria-controls|aria-selected|tabindex="-1"/);
  assert.doesNotMatch(html, /id="tab-|id="panel-|id="dock"|<aside\b|motion-toggle|free-columns|free-main|free-heading|<h2[^>]*data-i18n="tab\./);
  assert.doesNotMatch(html, /data-i18n(?:-label)?="(?:tab|guide|learn|settings|dock)\./);
  assert.doesNotMatch(html, /<dialog|aria-modal/);
  assert.equal((html.match(/<h2\b/g) || []).length, SECTIONS.length, 'the five section headings are the only h2 elements');
  assert.equal((html.match(/<main>/g) || []).length, 1);
});

test('Main starts with the live regions, stacks the five numbered sections in reading order and ends with the clock', () => {
  assert.ok(main);
  assert.match(main[1], /^\s*<p id="announcement" class="sr-only" role="status" aria-live="polite"><\/p>\s*<p id="error" role="alert" class="warning"><\/p>\s*<section id="input-card"/);
  assert.match(main[1], /<\/section>\s*<div id="clock" class="clock" role="group" data-i18n-label="clock\.title">[\s\S]*<\/div>\s*$/, 'the clock is the last child of main');
  const sections = [...main[1].matchAll(/\n    <section id="([\w-]+)" class="(card[^"]*)" aria-labelledby="([\w-]+)">/g)];
  assert.deepEqual(sections.map(match => match[1]), SECTIONS.map(section => section.id), 'five top-level sections in order');
  assert.deepEqual(sections.map(match => match[3]), SECTIONS.map(section => section.title));
  SECTIONS.forEach((section, index) => {
    const heading = tag(section.title);
    assert.equal(heading.name, 'h2', section.title);
    assert.equal(attribute(heading.attrs, 'class'), 'section-title');
    const pattern = new RegExp('<h2 id="' + section.title + '" class="section-title"><span class="section-number">' + (index + 1) + '</span> <span(?: id="[\\w-]+")? data-i18n="' + section.key.replace('.', '\\.') + '"></span></h2>');
    assert.match(html, pattern, section.id + ' heading reads "' + (index + 1) + ' " + the title from section.*');
  });
  assert.match(html, /<span id="bytes-title-text" data-i18n="section\.bytes"><\/span>/, 'app.js swaps the key of the bytes heading in hex mode');
  assert.ok(Object.hasOwn(messages.ja, 'section.bytesHex') && Object.hasOwn(messages.en, 'section.bytesHex'));
  inOrder(['input-title', 'input-mode', 'text-input', 'hex-input', 'input-error', 'preset-select', 'input-options-title', 'newline-select', 'trailing-newline', 'bom-check', 'text-notes',
    'bytes-title', 'input-stats', 'byte-grid', 'byte-legend', 'compute-title', 'stage-rail', 'position-block', 'position-index', 'stage', 'dropped-stats',
    'result-title', 'match-badge', 'digest-groups', 'radix-select', 'copy-hash', 'copy-bytes-spaced', 'copy-bytes-joined', 'copy-sha256sum', 'copy-worksheet', 'compare-input', 'compare-result', 'clock']);
});

test('Section 1 (input): mode radios, the two text areas, the hex help, the error line and the preset list', () => {
  const section = sliceBetween('input-card', 'input-options');
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
  assert.equal(attribute(tag('text-input').attrs, 'rows'), '4');
  assert.equal(attribute(tag('hex-input').attrs, 'rows'), '4');
  assert.equal(attribute(tag('compare-input').attrs, 'rows'), '1');
  assert.doesNotMatch(tag('text-input').attrs, /maxlength/);
  assert.match(tag('hex-field').attrs, /\bhidden\b/, 'text mode opens first');
  assert.doesNotMatch(tag('text-field').attrs, /\bhidden\b/);
  assert.match(section, /<p class="muted" data-i18n="input\.hex\.help"><\/p>/);
  assert.equal(attribute(tag('input-error').attrs, 'role'), 'alert');
  const preset = /<select id="preset-select">([\s\S]*?)<\/select>/.exec(section)[1];
  assert.match(preset, /<option value="" data-i18n="input\.preset\.none">/);
  assert.doesNotMatch(section, /newline-select|trailing-newline|bom-check|input\.limit|input\.encoding/, 'the settings live in section 2');
});

test('Section 2 (input settings): newline, trailing newline, BOM, the limit and the text notes', () => {
  const section = sliceBetween('input-options', 'bytes');
  assert.equal(tag('newline-select').name, 'select');
  const newline = /<select id="newline-select">([\s\S]*?)<\/select>/.exec(section)[1];
  assert.deepEqual([...newline.matchAll(/value="(\w+)"/g)].map(match => match[1]), ['lf', 'crlf']);
  for (const id of ['trailing-newline', 'bom-check']) {
    const box = tag(id).attrs;
    assert.equal(attribute(box, 'type'), 'checkbox', id);
    assert.doesNotMatch(box, /\bchecked\b/, id + ' starts unchecked');
  }
  assert.match(section, /<p class="muted" data-i18n="input\.limit"><\/p>/);
  assert.match(section, /<div id="text-notes" class="notes">\s*<p class="muted" data-i18n="input\.encoding"><\/p>\s*<p class="muted" data-i18n="input\.text\.help"><\/p>\s*<\/div>/);
  assert.equal((section.match(/<(?:input|select|textarea|button)\b/g) || []).length, 3, 'three controls');
});

test('Section 3 (bytes): statistics, grid and legend', () => {
  const section = sliceBetween('bytes', 'compute');
  assert.match(section, /<div id="input-stats" class="stats" data-i18n-label="stats\.title"><\/div>\s*<div id="byte-grid" class="byte-grid"><\/div>\s*<ul id="byte-legend" class="byte-legend" data-i18n-label="byte\.legend"><\/ul>/);
  assert.equal(tag('byte-legend').name, 'ul');
  assert.doesNotMatch(section, /<(?:input|select|textarea|button)\b/, 'no controls');
});

test('Section 4 (computation): rail, position line, the stage with six boards (padding visible first), then the overflow line', () => {
  const section = sliceBetween('compute', 'result');
  assert.match(section, /<nav id="stage-rail"[\s\S]*<\/nav>\s*<p class="position-line"><span id="position-block"><\/span><span id="position-index"><\/span><\/p>\s*<section id="stage" class="stage" aria-labelledby="stage-title">\s*<h3 id="stage-title" class="sr-only" data-i18n="stage\.title"><\/h3>/);
  assert.match(main[1], /<\/section>\s*<p id="dropped-stats" class="dropped-stats"><\/p>\s*<\/section>\s*<section id="result"/, 'the overflow statistics close the section');
  const stage = sliceBetween('stage', 'dropped-stats');
  const boards = [...stage.matchAll(/id="board-(\w+)"/g)].map(match => match[1]);
  assert.deepEqual(boards, BOARDS);
  for (const name of BOARDS) {
    const board = tag('board-' + name).attrs;
    assert.match(board, /^<section\b/);
    assert.equal(attribute(board, 'class'), 'board');
    assert.equal(attribute(board, 'aria-labelledby'), 'board-' + name + '-title');
    assert.equal(/\bhidden\b/.test(board), name !== 'pad', 'board-' + name + ' visibility');
    assert.equal(tag('board-' + name + '-title').name, 'h3');
    assert.match(stage, new RegExp('<h3 id="board-' + name + '-title"[^>]*></h3><div class="board-body"></div></section>'));
  }
  for (const name of ['schedule', 'round']) assert.equal(attribute(tag('board-' + name + '-title').attrs, 'data-i18n'), null, name + ' title takes {t} from app.js');
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

test('Section 5 (output): heading row with the badge, the digest band, the note, the radix, five copy buttons and the comparison', () => {
  const result = tag('result');
  assert.equal(result.name, 'section');
  assert.equal(attribute(result.attrs, 'aria-labelledby'), 'result-title');
  assert.equal(attribute(result.attrs, 'class'), 'card result');
  const section = sliceBetween('result', 'clock');
  assert.match(section, /<div class="result-head">\s*<h2 id="result-title" class="section-title">[\s\S]*?<\/h2>\s*<p id="match-badge" class="match-badge" role="status"><\/p>\s*<\/div>\s*<div id="digest-groups" class="digest-groups" data-radix="hex"><\/div>\s*<p class="result-note muted" data-i18n="result\.emptyNote" hidden><\/p>/);
  const radix = /<select id="radix-select">([\s\S]*?)<\/select>/.exec(section)[1];
  assert.deepEqual([...radix.matchAll(/value="(\w+)"/g)].map(match => match[1]), ['hex', 'bin', 'dec']);
  assert.deepEqual([...radix.matchAll(/data-i18n="([\w.]+)"/g)].map(match => match[1]), ['result.radix.hex', 'result.radix.bin', 'result.radix.dec']);
  const actions = /<div class="actions result-actions">([\s\S]*?)<\/div>/.exec(section);
  assert.ok(actions);
  const buttons = [...actions[1].matchAll(/<button id="([\w-]+)" type="button" data-i18n="(copy\.\w+)"><\/button>/g)];
  assert.deepEqual(buttons.map(match => match[1]), ['copy-hash', 'copy-bytes-spaced', 'copy-bytes-joined', 'copy-sha256sum', 'copy-worksheet']);
  assert.deepEqual(buttons.map(match => match[2]), ['copy.hash', 'copy.bytesSpaced', 'copy.bytesJoined', 'copy.sha256sum', 'copy.worksheet']);
  assert.equal((section.match(/<button\b/g) || []).length, 5, 'the copy buttons are the only buttons of the section');
  assert.match(section, /<\/div>\s*<div class="field">\s*<label for="compare-input" data-i18n="compare\.label"><\/label>\s*<textarea id="compare-input" rows="1"[^>]*><\/textarea>\s*<\/div>\s*<p id="compare-result" class="compare-result" role="status"><\/p>\s*<\/section>/, 'the comparison closes the section');
  assert.doesNotMatch(html, /copy-fallback/, 'the fallback field is created by app.js when the clipboard fails');
});

test('Live regions: announcement is polite, errors and the match badge are status or alert', () => {
  assert.equal(attribute(tag('announcement').attrs, 'aria-live'), 'polite');
  assert.equal(attribute(tag('announcement').attrs, 'role'), 'status');
  assert.equal(attribute(tag('error').attrs, 'role'), 'alert');
  assert.equal(attribute(tag('input-error').attrs, 'role'), 'alert');
  assert.equal(attribute(tag('match-badge').attrs, 'role'), 'status');
  assert.equal(attribute(tag('compare-result').attrs, 'role'), 'status');
});

test('Header: title, then two round icon buttons (language, theme) right-aligned, then the description', () => {
  const header = /<header class="page-header">([\s\S]*?)<\/header>/.exec(html);
  assert.ok(header);
  assert.match(header[1], /^\s*<h1 data-i18n="title"><\/h1>\s*<div class="header-tools">[\s\S]*<\/div>\s*<p data-i18n="description"><\/p>\s*$/);
  const tools = /<div class="header-tools">([\s\S]*?)<\/div>/.exec(header[1])[1];
  const buttons = [...tools.matchAll(/<button\b([^>]*)>/g)].map(match => match[1]);
  assert.deepEqual(buttons.map(attrs => attribute(attrs, 'id')), ['lang-toggle', 'theme-toggle']);
  for (const attrs of buttons) {
    assert.equal(attribute(attrs, 'class'), 'icon-button');
    assert.equal(attribute(attrs, 'type'), 'button');
    assert.equal(attribute(attrs, 'data-i18n'), null, 'textContent would wipe the icon');
    assert.doesNotMatch(attrs, /aria-pressed/, 'the label names the next state instead');
  }
  assert.equal(attribute(buttons[0], 'data-i18n-label'), 'language');
  assert.equal(attribute(buttons[1], 'data-i18n-label'), 'theme.toLight', 'dark is the default, so the button offers light');
  const lang = /<button id="lang-toggle"[^>]*>([\s\S]*?)<\/button>/.exec(tools)[1];
  const theme = /<button id="theme-toggle"[^>]*>([\s\S]*?)<\/button>/.exec(tools)[1];
  assert.deepEqual([...lang.matchAll(/<svg\b([^>]*)>/g)].map(match => attribute(match[1], 'class')), ['icon-translate']);
  const themeIcons = [...theme.matchAll(/<svg\b([^>]*)>/g)].map(match => match[1]);
  assert.deepEqual(themeIcons.map(attrs => attribute(attrs, 'class')), ['icon-sun', 'icon-moon']);
  assert.doesNotMatch(themeIcons[0], /\shidden(?:\s|$)/, 'the sun shows while the page is dark');
  assert.match(themeIcons[1], /\shidden(?:\s|$)/, 'the moon waits for the light theme');
  assert.doesNotMatch(lang + theme, /[^\s<>]+(?=<)/, 'icon buttons have no text of their own');
});

test('Inline SVG icons are static line art: 24-unit viewBox, currentColor stroke, hidden from AT, no style or size attributes', () => {
  const svgs = [...html.matchAll(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/g)];
  assert.equal(svgs.length, 3);
  for (const [, attrs, body] of svgs) {
    for (const [name, value] of Object.entries(SVG_ATTRIBUTES)) assert.equal(attribute(attrs, name), value, name);
    assert.doesNotMatch(attrs, /\s(?:style|width|height|on\w+|xmlns:xlink|id)=/);
    assert.doesNotMatch(body, /\s(?:style|on\w+|fill|stroke|class|id)=|<(?:script|style|a|image|foreignObject|use|text)\b|href=/);
    assert.match(body, /^(?:\s*<(?:path|circle|line|ellipse|polyline|rect)\b[^>]*\/>)+\s*$/, 'only self-closing shapes');
  }
  assert.ok(!/<svg\b[^>]*>[\s\S]*?<\/svg>/.test(html.replace(/<header class="page-header">[\s\S]*?<\/header>/, '')), 'icons live in the header only');
});

test('Clock controls expose the contract options', () => {
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
  assert.doesNotMatch(html, /theme-select|settings\.theme\b/);
  for (const id of ['copy-hash', 'copy-bytes-spaced', 'copy-bytes-joined', 'copy-sha256sum', 'copy-worksheet', 'lang-toggle', 'theme-toggle']) {
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
  assert.match(html, /<footer><p data-i18n="privacy"><\/p><p data-i18n="author"><\/p><a\b[^>]*><\/a><\/footer>/, 'three footer lines');
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
