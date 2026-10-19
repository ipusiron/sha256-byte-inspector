/* Static checks on app.js (the DOM wiring cannot run under node:test without a
 * browser; the behaviour is probed with Playwright). These tests read the source:
 * every literal t('key', { ... }) call passes exactly the substitution names the
 * dictionary declares, every literal key exists, the storage keys are the language
 * and the display (theme only), the elements it reaches by id exist in index.html,
 * the modules it reads from window are the five UMD globals, the single page has
 * no tab, panel, dock or motion handling, the computation section is built once and
 * updated by classes, autoplay runs on a setTimeout chain, the clock follows the
 * current row with scrollIntoView unless the user just scrolled, the help dialog
 * uses showModal/close, and the DOM is built with createElement/textContent only. */
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
  /* Keys chosen in a conditional or a loop rather than written inside t('...'). */
  for (const key of ['compute.round.registersAfter', 'compute.round.registers', 'help.can.1', 'help.can.2', 'help.can.3', 'help.keys.arrows', 'help.keys.shiftArrows', 'help.keys.page', 'help.keys.homeEnd', 'help.keys.digits', 'help.keys.space', 'help.keys.help', 'clock.pause', 'clock.play']) {
    assert.ok(app.includes("'" + key + "'"), key + ' is named in app.js');
    assert.ok(Object.hasOwn(messages.ja, key) && Object.hasOwn(messages.en, key), key + ' exists');
  }
  assert.match(app, /t\(shown\.after \? 'compute\.round\.registersAfter' : 'compute\.round\.registers', \{ t: shown\.t \}\)/);
  assert.deepEqual(parameters(messages.ja['compute.round.registers']), ['t']);
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
  assert.match(app, /const PANELS = \['block', 'schedule', 'round', 'final', 'digest'\];/);
  assert.match(app, /const PANEL_OF = Object\.freeze\(\{ pad: 'block', split: 'block', schedule: 'schedule', round: 'round', final: 'final', digest: 'digest' \}\);/);
  for (const gone of ["'tab-'", "'panel-'", 'motion-toggle', "'dock'", 'free-main', 'free-columns', 'board-pad', 'board-split', "data-phase=\"input\""]) assert.ok(!app.includes(gone), gone + ' is gone');
  for (const id of ['input-title', 'bytes-title-text', 'stage-rail', 'digest-groups', 'radix-select', 'match-badge', 'dropped-stats', 'compare-input', 'clock', 'clock-position', 'help-dialog', 'help-button', 'help-close', 'help-title', 'help-body', 'input-options']) {
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
  /* The radix select applies to the bands of the computation and to the digest of the output. */
  assert.match(app, /\$\('radix-select'\)\.addEventListener\('change', \(\) => \{\s*const value = \$\('radix-select'\)\.value;\s*state\.radix = RADIXES\.includes\(value\) \? value : 'hex';\s*renderPosition\(false\);\s*renderResult\(\);\s*\}\);/);
  assert.match(app, /groups\.dataset\.radix = state\.radix;/);
  assert.match(app, /if \(state\.radix === 'bin'\) return w\.bin\.replace/, 'binary digests show 32 digits per word');
  /* The clipboard fallback field is created right after the copy buttons. */
  assert.match(app, /\$\('result'\)\.querySelector\('\.result-actions'\)\.after\(area\);/);
  assert.doesNotMatch(app, /dock\.digest|settings\.theme/);
  /* Hex mode fades the labels of the settings section; the legend lists non-text classes only. */
  assert.match(app, /\$\('input-options'\)\.toggleAttribute\('data-off', hex\);/);
  assert.match(app, /if \(cell\.cls !== 'text' && !seen\.has\(cell\.cls\)\) seen\.set\(cell\.cls, cell\.hex\);/);
  assert.match(app, /legend\.replaceChildren\(caption\);/);
  assert.match(app, /legend\.hidden = seen\.size === 0;/);
});

test('The computation section is built once per block, result, language and radix; a step only moves classes and refills bands', () => {
  assert.match(app, /function buildCompute\(block\)/);
  assert.match(app, /function updateCompute\(reveal\)/);
  assert.match(app, /if \(!cv \|\| cv\.block !== block \|\| cv\.blocks !== state\.result\.blocks \|\| cv\.lang !== language \|\| cv\.radix !== state\.radix\) buildCompute\(block\);\s*else if \(cv\.result !== state\.result\) refillCompute\(cv, block\);/, 'a new result of the same shape is written into the existing elements');
  assert.match(app, /function refillCompute\(cv, block\)/);
  assert.match(app, /rowView\.texts\[i\]\.data = core\.hexWord\(after\[i\]\);/, 'table cells are text nodes rewritten in place');
  assert.match(app, /bitsTemplate\.cloneNode\(true\)/, 'bit rows are cloned from one template');
  assert.match(app, /function fillBits\(cells, bitList, extra\)/);
  assert.match(app, /cell\.className = className;/);
  assert.match(app, /function setScheduleCurrent\(cv, index\)/);
  assert.match(app, /row\.classList\.add\('is-current'\);/);
  assert.match(app, /for \(const n of \[16, 15, 7, 2\]\) \{\s*const i = index - n;\s*cv\.scheduleRows\[i\]\.dataset\.ref = String\(n\);/, 'the four referenced rows are tagged');
  assert.match(app, /cv\.scheduleInsert\.fill\(view\.scheduleModel\(cv\.trace, index\)\);\s*row\.after\(cv\.scheduleInsert\.element\);/, 'the bands of W[t] are slotted under its row');
  assert.match(app, /function setRoundCurrent\(cv, phase, index\)/);
  assert.match(app, /cv\.tableRows\[index\]\.classList\.add\('is-current'\);\s*cv\.tableRows\[index\]\.setAttribute\('aria-current', 'step'\);/);
  assert.match(app, /goToStep\(core\.stepOf\(state\.result\.blocks, \{ phase: 'round', block: cv\.block, index: Number\(row\.dataset\.t\) \}\), true, false\);/, 'pressing a table row moves the clock to that round');
  assert.match(app, /goToStep\(core\.stepOf\(state\.result\.blocks, \{ phase: 'split', block: b, index: 0 \}\), true, false\);/, 'the ordinal buttons switch the block');
  assert.doesNotMatch(app, /function renderStage|renderPad|renderSplit|renderSchedule\(|renderRound\(|renderFinal|renderDigest/, 'the per-phase boards are gone');
  assert.match(app, /const RAIL = \['pad', 'split', 'schedule', 'round', 'final', 'digest'\];/);
  assert.match(app, /\/\^\[1-6\]\$\//, 'digits 1 to 6 jump to the six phases');
  assert.doesNotMatch(app, /phase === 'input'/);
  assert.match(app, /title\.scrollIntoView\(\{ block: 'start' \}\);\s*title\.focus\(\{ preventScroll: true \}\);/, 'a rail button scrolls to the panel');
  assert.match(app, /if \(m\.blocks < 2 \|\| m\.blockNumber === null \|\| m\.phase === 'pad'\) return '';/, 'the block number shows for two blocks or more only');
});

test('Autoplay: a setTimeout chain at 1000ms / speed that leaves the browser idle time, stopping at the last step, quiet for the live region, labelled Pause while playing', () => {
  assert.match(app, /const PLAY_INTERVAL = 1000;/);
  assert.match(app, /const PLAY_IDLE_FACTOR = 3;/);
  assert.match(app, /const delay = Math\.max\(PLAY_INTERVAL \/ speedFactor\(\), \(cost \|\| 0\) \* PLAY_IDLE_FACTOR\);/, 'a slow step stretches the interval');
  assert.match(app, /window\.requestAnimationFrame\(\(\) => \{\s*if \(!playing\) return;\s*window\.clearTimeout\(playTimer\);\s*playTimer = window\.setTimeout\(tickPlay, delay\);\s*\}\);/, 'the delay starts after the step is painted');
  assert.doesNotMatch(app, /setInterval/);
  assert.deepEqual([...app.matchAll(/requestAnimationFrame/g)].length, 2, 'rAF is used for the layout measurement and the autoplay pacing only');
  assert.match(app, /const last = totalSteps\(\) - 1;\s*const k = stepIndex\(\);\s*if \(k >= last\) \{\s*stopPlay\(\);\s*return;\s*\}\s*const started = performance\.now\(\);\s*goToStep\(k \+ 1, false, true\);\s*const cost = performance\.now\(\) - started;/, 'one step per tick, no announcement, scrolled into view, timed');
  assert.match(app, /if \(stepIndex\(\) >= last\) \{\s*stopPlay\(\);\s*return;\s*\}\s*armPlay\(cost\);/, 'the chain stops at the end');
  assert.match(app, /button\.dataset\.i18nLabel = playing \? 'clock\.pause' : 'clock\.play';/);
  assert.match(app, /button\.setAttribute\('aria-pressed', String\(playing\)\);/);
  assert.match(app, /button\.textContent = playing \? PAUSE_GLYPH : PLAY_GLYPH;/);
  assert.match(app, /function recompute\(\) \{\s*stopPlay\(\);/, 'a new input stops the playback');
  assert.match(app, /\$\('clock-speed'\)\.addEventListener\('change', \(\) => \{ if \(playing\) armPlay\(\); \}\);/, 'a speed change re-arms the timer');
  assert.match(app, /\$\('clock-play'\)\.addEventListener\('click', togglePlay\);/);
  assert.match(app, /if \(state\.result\) \$\('announcement'\)\.textContent = positionText\(\);\s*\}/, 'stopping announces the position once');
  /* Space toggles playback unless a text field, select, button or link has the focus. */
  assert.match(app, /if \(tag === 'TEXTAREA' \|\| tag === 'INPUT' \|\| tag === 'SELECT'\) return;/);
  assert.match(app, /case ' ':\s*case 'Spacebar':\s*if \(tag === 'BUTTON' \|\| tag === 'A' \|\| tag === 'SUMMARY'\) handled = false;\s*else togglePlay\(\);/);
});

test('Following the clock: one layout read and one scroll for manual steps and autoplay only, paused for a second after the user scrolls', () => {
  assert.match(app, /const FOLLOW_PAUSE = 1000;/);
  assert.match(app, /if \(performance\.now\(\) - userScrollAt < FOLLOW_PAUSE\) return;/);
  assert.match(app, /const a = anchor\.getBoundingClientRect\(\);\s*let delta = 0;\s*if \(a\.top < 0\) delta = a\.top;\s*else if \(a\.bottom > limit\) delta = Math\.min\(a\.bottom - limit, a\.top\);/, 'nearest: up to the top edge, or down until the row clears the clock');
  assert.match(app, /if \(delta !== 0\) \{\s*ownScrollUntil = performance\.now\(\) \+ OWN_SCROLL_WINDOW;\s*window\.scrollBy\(0, delta\);/);
  assert.doesNotMatch(app, /anchor\.scrollIntoView\(/, 'scrollIntoView forced several layouts per step');
  assert.match(app, /window\.addEventListener\('wheel', noteUserScroll, \{ passive: true \}\);\s*window\.addEventListener\('touchmove', noteUserScroll, \{ passive: true \}\);/);
  assert.match(app, /window\.addEventListener\('scroll', \(\) => \{\s*if \(performance\.now\(\) > ownScrollUntil\) noteUserScroll\(\);\s*\}, \{ passive: true \}\);/);
  assert.match(app, /const limit = window\.innerHeight - clockHeight\(\);/, 'the fixed clock does not hide the row');
  assert.match(app, /function goToStep\(k, announce, reveal\)/);
  assert.match(app, /renderPosition\(reveal\);\s*if \(announce\) \$\('announcement'\)\.textContent = positionText\(\);/);
  assert.match(app, /function renderPosition\(reveal\) \{\s*renderRail\(\);\s*updateCompute\(reveal === true\);/);
  for (const call of ["goToStep(0, true, true)", 'goToStep(totalSteps() - 1, true, true)', "goToStep(Number($('clock-range').value), true, true)", 'goToStep(k + direction, true, true)']) {
    assert.ok(app.includes(call), call + ' reveals the row');
  }
  /* Renders that are not steps do not scroll: start-up, language, Web Crypto, radix, fragment. */
  assert.equal((app.match(/renderPosition\(false\)/g) || []).length, 5, 'five non-scrolling renders');
  assert.doesNotMatch(app, /renderPosition\(\)/);
  assert.doesNotMatch(app, /behavior:\s*'smooth'/, 'no smooth scrolling (the OS motion setting is respected by instant jumps)');
});

test('Help dialog: showModal on the button and on "?", focus to the heading, closed by the button, Esc or the backdrop, focus back to the button', () => {
  assert.match(app, /if \(typeof dialog\.showModal === 'function'\) dialog\.showModal\(\);/);
  assert.match(app, /\$\('help-title'\)\.focus\(\);/);
  assert.match(app, /if \(typeof dialog\.close === 'function'\) dialog\.close\(\);/);
  assert.match(app, /\$\('help-button'\)\.addEventListener\('click', openHelp\);/);
  assert.match(app, /\$\('help-close'\)\.addEventListener\('click', closeHelp\);/);
  assert.match(app, /dialog\.addEventListener\('click', event => \{\s*if \(event\.target === dialog\) closeHelp\(\);\s*\}\);/, 'a click on the backdrop closes');
  assert.match(app, /dialog\.addEventListener\('close', \(\) => \{\s*\$\('help-button'\)\.focus\(\);\s*\}\);/);
  /* "?" opens the help before the result check, but not while typing or while it is open. */
  assert.match(app, /if \(helpOpen\(\)\) return;\s*if \(event\.key === '\?'\) \{\s*event\.preventDefault\(\);\s*openHelp\(\);\s*return;\s*\}\s*if \(!state\.result\) return;/);
  assert.match(app, /function buildHelp\(\)/);
  assert.match(app, /node\('kbd', name\)/, 'key names are shown in kbd elements');
  assert.doesNotMatch(app, /createElement\(\s*'a'\s*\)|node\('a'/, 'no links are created');
  assert.match(app, /parts\.push\(node\('h3', t\('help\.privacy\.title'\)\), node\('p', t\('privacy'\)\), node\('p', t\('help\.reference'\), 'muted'\)\);/, 'the privacy line is the footer wording');
});

test('The clock height is measured into --clock-height at start-up, on resize and when the position text changes', () => {
  assert.match(app, /const CLOCK_MARGIN = 8;/);
  assert.match(app, /const height = \$\('clock'\)\.offsetHeight;\s*if \(height === 0\) return;\s*document\.documentElement\.style\.setProperty\('--clock-height', \(height \+ CLOCK_MARGIN\) \+ 'px'\);/);
  assert.match(app, /window\.addEventListener\('resize', scheduleLayout\);/);
  assert.match(app, /updateClockHeight\(\);\s*\}\s*perform\(init\);/, 'measured once init has drawn the page');
  assert.deepEqual([...app.matchAll(/style\.setProperty\(\s*'([^']+)'/g)].map(match => match[1]), ['--clock-height'], 'the only CSSOM write');
  assert.match(app, /matches\('\(max-width: 767px\)'\)\) \$\('clock'\)\.classList\.add\('is-hidden'\)/, 'the clock hides while a text area has focus on phones');
  assert.match(app, /\$\('clock-position'\)\.textContent = text;\s*scheduleLayout\(\);/, 'the position text can wrap and change the height');
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
