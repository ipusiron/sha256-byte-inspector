/* Tests for messages.js and the wording rules of CLAUDE.md: identical key sets
 * and substitutions in both languages, the key list of the contract (the five
 * section headings in the section.* namespace, no tab, guide, learn, settings or
 * dock keys), the keys referenced by index.html and app.js, no Japanese (or any
 * non-ASCII) in the JavaScript outside the Japanese values of messages.js, the
 * words the Japanese copy avoids, no spaces between Japanese and Latin
 * characters, polite sentence endings, no claims of tamper prevention or
 * verification, and preset labels for every preset. Japanese in this file is
 * written with \uXXXX escapes; the comments name each word. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const messages = require('../messages.js');
const presets = require('../presets.js');
const input = require('../input-core.js');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

/* Kana, kanji, CJK punctuation and fullwidth forms. */
const JAPANESE = /[\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/;
/* Kana or kanji next to a space next to a Latin letter or digit. */
const SPACED = /[\u3040-\u30ff\u3400-\u9fff] +[A-Za-z0-9]|[A-Za-z0-9] +[\u3040-\u30ff\u3400-\u9fff]/;
/* Same list as Day117: sude-ni (already), subete (all), wakaru (understand) and
 * nai (none) in closed kanji; "intaafeesu" spelling; the counter ka-sho; ni-kagiru;
 * soutei-shite-inai; the literal-translation verbs kiku, hashiru, shougou and
 * tsukiawase; the preambles chuumoku-subeki and koko-de-juuyou-na-no-wa; and
 * katakana loanwords without the long-vowel mark (saaba, yuuza, burauza, foruda,
 * parameeta, edita, maneeja, ripojitori). */
const FORBIDDEN = /\u65e2\u306b|\u5168\u3066|\u5206\u304b\u308b|\u7121\u3044|\u30a4\u30f3\u30bf\u30fc\u30d5\u30a7\u30fc\u30b9|\d+(?:\u304b\u6240|\u7b87\u6240)|\u306b\u9650\u308b|\u60f3\u5b9a\u3057\u3066\u3044\u306a\u3044|\u52b9\u304f|\u8d70\u308b|\u7167\u5408|\u7a81\u304d\u5408\u308f\u305b|\u6ce8\u76ee\u3059\u3079\u304d|\u3053\u3053\u3067\u91cd\u8981\u306a\u306e\u306f|(?:\u30b5\u30fc\u30d0|\u30e6\u30fc\u30b6|\u30d6\u30e9\u30a6\u30b6|\u30d5\u30a9\u30eb\u30c0|\u30d1\u30e9\u30e1\u30fc\u30bf|\u30a8\u30c7\u30a3\u30bf|\u30de\u30cd\u30fc\u30b8\u30e3|\u30ea\u30dd\u30b8\u30c8\u30ea)(?!\u30fc)/;
/* Claims the tool must not make: preventing or proving tampering, being a
 * verification tool, finding preimages, decrypting or decoding. */
const CLAIMS_JA = /\u6539\u3056\u3093\u3092\u9632\u3050|\u6539\u3056\u3093\u9632\u6b62|\u6539\u3056\u3093\u306e\u8a3c\u660e|\u691c\u8a3c\u30c4\u30fc\u30eb|\u539f\u50cf\u3092\u6c42\u3081|\u5fa9\u53f7|\u89e3\u8aad/;
const CLAIMS_EN = /tamper[- ]?proof|prevents? tampering|proof of tampering|verification tool|decrypt|decode the hash|reverse the hash|find(?:s|ing)? (?:a |the )?preimage/i;
/* Polite sentence endings (desu/masu forms), optionally followed by a parenthesis. */
const POLITE_END = /(?:\u3067\u3059|\u307e\u3059|\u307e\u305b\u3093|\u307e\u3057\u305f|\u3067\u3057\u305f|\u307e\u3057\u3087\u3046|\u304f\u3060\u3055\u3044)(?:\uff08[^\uff09]*\uff09)?$/;
/* Words of the retired layout: keiki (instruments, the dock), nyuuguchi (entrance) and tabu (tab). */
const RETIRED_WORDS = /\u8a08\u5668|\u5165\u53e3|\u30bf\u30d6/;

const REQUIRED = [
  'title', 'description', 'language',
  'section.input', 'section.options', 'section.bytes', 'section.bytesHex', 'section.compute', 'section.result',
  'input.mode', 'input.mode.text', 'input.mode.hex', 'input.text.label', 'input.text.help', 'input.hex.label', 'input.hex.help', 'input.encoding',
  'input.newline', 'input.newline.lf', 'input.newline.crlf', 'input.trailing', 'input.bom', 'input.preset', 'input.preset.none', 'input.limit',
  'stats.title', 'stats.codePoints', 'stats.utf16', 'stats.bytes', 'stats.blocks', 'stats.newlines', 'stats.trailing.none', 'stats.trailing.lf', 'stats.trailing.crlf',
  'stats.bom', 'stats.loneSurrogates', 'stats.normalization.nfc', 'stats.normalization.nfd', 'stats.normalization.both', 'stats.normalization.neither',
  'byte.legend',
  'error.hex.odd-length', 'error.hex.invalid-char', 'error.limit', 'error.generic', 'error.cryptoUnavailable', 'error.fragment', 'error.fragmentLimit',
  'warning.dump-like', 'warning.hash-like', 'warning.lone-surrogate',
  'preset.group.basic', 'preset.group.bytes', 'preset.group.newline', 'preset.group.unicode', 'preset.group.day117',
  'rail.title', 'rail.input', 'rail.pad', 'rail.split', 'rail.schedule', 'rail.round', 'rail.final', 'rail.digest', 'rail.block',
  'phase.pad', 'phase.split', 'phase.schedule', 'phase.round', 'phase.final', 'phase.digest',
  'stage.title', 'stage.dropped',
  'board.pad.title', 'board.pad.message', 'board.pad.one', 'board.pad.zeros', 'board.pad.length', 'board.pad.blocks', 'board.pad.boundary',
  'board.split.title', 'board.split.word',
  'board.schedule.title', 'board.schedule.refs', 'board.schedule.sigma0', 'board.schedule.sigma1', 'board.schedule.rotr', 'board.schedule.shr', 'board.schedule.sum', 'board.schedule.fromBlock',
  'board.round.title', 'board.round.before', 'board.round.after', 'board.round.S1', 'board.round.ch', 'board.round.S0', 'board.round.maj',
  'board.round.T1', 'board.round.T2', 'board.round.newE', 'board.round.newA', 'board.round.K', 'board.round.W', 'board.round.newly',
  'board.final.title', 'board.final.lane', 'board.digest.title', 'board.digest.concat',
  'board.raw', 'board.dropped', 'board.out', 'board.overflow',
  'result.emptyNote', 'result.match.ok', 'result.match.ng', 'result.match.unknown', 'result.match.pending', 'result.radix', 'result.radix.hex', 'result.radix.bin', 'result.radix.dec',
  'copy.hash', 'copy.bytesSpaced', 'copy.bytesJoined', 'copy.sha256sum', 'copy.worksheet', 'copy.done', 'copy.failed', 'copy.fallback',
  'compare.label', 'compare.placeholder', 'compare.match', 'compare.mismatch', 'compare.none', 'compare.multiple', 'compare.normalized',
  'clock.title', 'clock.range', 'clock.first', 'clock.prev', 'clock.play', 'clock.pause', 'clock.next', 'clock.last', 'clock.granularity',
  'clock.granularity.step', 'clock.granularity.eight', 'clock.granularity.phase', 'clock.granularity.block', 'clock.speed', 'clock.position',
  'theme.toLight', 'theme.toDark',
  'privacy', 'author', 'repository', 'noscript.ja', 'noscript.en', 'busy', 'ready'
];
/* Keys of the retired entrances, panels and dock (and the headings they replaced). */
const RETIRED = [
  'tabs', 'tab.guide', 'tab.free', 'tab.learn', 'tab.settings', 'guide.placeholder', 'learn.placeholder', 'learn.section.1', 'learn.section.12',
  'dock.title', 'dock.match.ok', 'dock.match.ng', 'dock.match.unknown', 'dock.match.pending', 'dock.radix', 'dock.radix.hex', 'dock.dropped', 'dock.copy', 'dock.digest',
  'settings.title', 'settings.themeNote', 'settings.motion', 'settings.motion.note', 'settings.theme', 'settings.theme.dark', 'settings.theme.light',
  'input.title', 'byte.title', 'result.title'
];
const SUBSTITUTIONS = {
  'stats.newlines': ['cr', 'crlf', 'lf'], 'stats.loneSurrogates': ['n'],
  'error.hex.odd-length': ['column', 'line', 'position'], 'error.hex.invalid-char': ['char', 'column', 'line', 'name', 'position'],
  'error.limit': ['max'], 'error.fragmentLimit': ['max'], 'warning.lone-surrogate': ['n'], 'rail.block': ['n', 'total'],
  'phase.schedule': ['t'], 'phase.round': ['t'], 'board.pad.zeros': ['count'], 'board.pad.length': ['bits'], 'board.pad.blocks': ['n'],
  'board.schedule.title': ['t'], 'board.schedule.rotr': ['n'], 'board.schedule.shr': ['n'], 'board.round.title': ['t'],
  'board.final.lane': ['i'], 'board.dropped': ['n'], 'stage.dropped': ['f', 'ft', 'm', 's', 'st', 't', 'tt'],
  'compare.multiple': ['n'], 'clock.position': ['id']
};
const NAMESPACES = /^(?:title|description|language|privacy|author|repository|busy|ready|noscript\.(?:ja|en)|(?:section|input|stats|byte|cls|error|warning|preset|rail|phase|stage|board|result|copy|compare|clock|theme)\..+)$/;

const parameters = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

function jsFiles(dir = root, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === '.git' || entry.name === 'node_modules') return [];
    if (entry.isDirectory()) return jsFiles(path.join(dir, entry.name), prefix + entry.name + '/');
    return entry.name.endsWith('.js') ? [prefix + entry.name] : [];
  });
}

test('Japanese and English keys and substitutions match', () => {
  const keys = Object.keys(messages.ja);
  assert.ok(keys.length > 150, String(keys.length));
  assert.deepEqual(keys.slice().sort(), Object.keys(messages.en).sort());
  assert.deepEqual(keys, Object.keys(messages.en), 'same order in both blocks');
  for (const key of keys) {
    assert.equal(typeof messages.ja[key], 'string', key);
    assert.equal(typeof messages.en[key], 'string', key);
    assert.ok(messages.ja[key].length > 0 && messages.en[key].length > 0, key + ' is empty');
    assert.deepEqual(parameters(messages.ja[key]), parameters(messages.en[key]), key);
    assert.match(key, NAMESPACES, key + ' is outside the contract namespaces');
  }
  assert.ok(Object.isFrozen(messages.ja) && Object.isFrozen(messages.en));
});

test('The key list of the contract is complete (sections, classes, every preset) and the retired keys are gone', () => {
  const required = REQUIRED.slice();
  for (const cls of input.CLASSES) required.push('cls.' + cls);
  assert.equal(input.CLASSES.length, 15);
  assert.deepEqual(Object.keys(messages.ja).filter(key => key.startsWith('cls.')).map(key => key.slice(4)).sort(), input.CLASSES.slice().sort());
  for (const preset of presets.list) required.push('preset.' + preset.id, 'preset.group.' + preset.group);
  assert.equal(presets.list.length, 44);
  for (const key of required) assert.ok(Object.hasOwn(messages.ja, key), 'missing ' + key);
  for (const key of RETIRED) assert.ok(!Object.hasOwn(messages.ja, key) && !Object.hasOwn(messages.en, key), key + ' was retired');
  for (const key of Object.keys(messages.ja)) assert.doesNotMatch(key, /^(?:tab|tabs$|guide|learn|dock|settings)/, key);
  for (const [key, names] of Object.entries(SUBSTITUTIONS)) assert.deepEqual(parameters(messages.ja[key]), names, key);
  for (const key of Object.keys(messages.ja)) {
    if (!Object.hasOwn(SUBSTITUTIONS, key)) assert.deepEqual(parameters(messages.ja[key]), [], key + ' has unexpected substitutions');
  }
});

test('Section headings: six section.* keys, the number lives in the markup, the bytes heading has a hex variant', () => {
  const keys = Object.keys(messages.ja).filter(key => key.startsWith('section.'));
  assert.deepEqual(keys, ['section.input', 'section.options', 'section.bytes', 'section.bytesHex', 'section.compute', 'section.result'], 'in reading order');
  for (const key of keys) {
    for (const lang of ['ja', 'en']) {
      assert.doesNotMatch(messages[lang][key], /^\d/, lang + ' ' + key + ' carries no number (the marker is in index.html)');
      assert.doesNotMatch(messages[lang][key], /[.\u3002]$/, lang + ' ' + key + ' is a label');
    }
  }
  /* nyuuryoku (input), nyuuryoku no settei (input settings), UTF-8 ni henkan shita baito-retsu
   * (bytes after UTF-8 encoding), watasu baito-retsu (16-shin no mama) (bytes as given, hex),
   * SHA-256 no keisan (computation), shutsuryoku (SHA-256) (output). */
  assert.equal(messages.ja['section.input'], '\u5165\u529b');
  assert.equal(messages.ja['section.options'], '\u5165\u529b\u306e\u8a2d\u5b9a');
  assert.equal(messages.ja['section.bytes'], 'UTF-8\u306b\u5909\u63db\u3057\u305f\u30d0\u30a4\u30c8\u5217');
  assert.equal(messages.ja['section.bytesHex'], '\u6e21\u3059\u30d0\u30a4\u30c8\u5217\uff0816\u9032\u306e\u307e\u307e\uff09');
  assert.equal(messages.ja['section.compute'], 'SHA-256\u306e\u8a08\u7b97');
  assert.equal(messages.ja['section.result'], '\u51fa\u529b\uff08SHA-256\uff09');
  assert.equal(messages.en['section.input'], 'Input');
  assert.equal(messages.en['section.options'], 'Input settings');
  assert.equal(messages.en['section.bytes'], 'Bytes after UTF-8 encoding');
  assert.equal(messages.en['section.bytesHex'], 'Bytes as given (hex)');
  assert.equal(messages.en['section.compute'], 'SHA-256 computation');
  assert.equal(messages.en['section.result'], 'Output (SHA-256)');
});

test('Keys referenced by index.html and app.js exist', () => {
  const html = read('index.html');
  const staticKeys = [...html.matchAll(/data-i18n(?:-label)?="([^"]+)"/g)].map(match => match[1]);
  assert.ok(staticKeys.length > 60);
  for (const key of staticKeys) assert.ok(Object.hasOwn(messages.ja, key), key);
  const app = read('app.js');
  const literalKeys = [...app.matchAll(/\bt\(\s*'([\w.-]+)'\s*[,)]/g)].map(match => match[1]);
  assert.ok(literalKeys.length > 20, 'app.js reads its wording through t()');
  for (const key of literalKeys) assert.ok(Object.hasOwn(messages.ja, key), key);
  /* Keys set as whole strings in a conditional rather than through t('...') directly. */
  for (const key of ['section.bytes', 'section.bytesHex', 'theme.toLight', 'theme.toDark']) assert.ok(app.includes("'" + key + "'") && Object.hasOwn(messages.ja, key), key);
});

test('JavaScript is ASCII except the Japanese values of messages.js, with LF line endings', () => {
  const files = jsFiles();
  assert.ok(files.includes('messages.js') && files.includes('sha256-core.js') && files.includes('test/i18n.test.js'));
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /\r/, file + ' has CR');
    if (file === 'messages.js') continue;
    const match = /[^\x00-\x7f]/.exec(source);
    assert.equal(match, null, file + ' has non-ASCII at index ' + (match ? match.index : -1));
  }
  const lines = read('messages.js').split('\n');
  const enStart = lines.indexOf('  const en = {');
  assert.ok(enStart > 0, 'the English block starts with "  const en = {"');
  assert.ok(lines.indexOf('  const ja = {') > 0 && lines.indexOf('  const ja = {') < enStart);
  lines.forEach((line, index) => {
    const entry = /^ {4}"([A-Za-z0-9.-]+)": "(?:[^"\\]|\\.)*",?$/.exec(line);
    if (entry && index < enStart) return;
    assert.doesNotMatch(line, /[^\x00-\x7f]/, 'messages.js line ' + (index + 1) + ' has non-ASCII outside a Japanese value');
  });
});

test('Japanese wording: avoided words, no spaces around Latin text, no line ending with a colon, no words of the retired layout', () => {
  for (const [key, value] of Object.entries(messages.ja)) {
    assert.doesNotMatch(value, FORBIDDEN, key);
    assert.doesNotMatch(value, SPACED, key);
    assert.doesNotMatch(value, /[\uff1a:]$/m, key);
    assert.doesNotMatch(value, /[\uff01\uff1f!?]/, key + ' avoids exclamation and question marks');
    assert.doesNotMatch(value, RETIRED_WORDS, key + ' names no instruments, entrance or tab');
  }
  /* Case-sensitive: "TAB (09)" names the control character, not a tab of the page. */
  for (const [key, value] of Object.entries(messages.en)) assert.doesNotMatch(value, /\b(?:[Ii]nstruments?|[Dd]ock|[Ee]ntrance|[Tt]ab)\b/, key);
});

test('Japanese sentences end in the polite form; labels have no sentence-final period', () => {
  let sentences = 0;
  for (const [key, value] of Object.entries(messages.ja)) {
    if (key === 'noscript.en') continue;
    if (!value.includes('\u3002')) continue;
    for (const sentence of value.split('\u3002')) {
      if (sentence.trim() === '') continue;
      sentences += 1;
      assert.match(sentence, POLITE_END, key + ': ' + sentence);
    }
  }
  assert.ok(sentences > 30, String(sentences));
});

test('English has no Japanese beyond the language switch and noscript.ja, and no trailing colon', () => {
  for (const [key, value] of Object.entries(messages.en)) {
    if (key === 'language') {
      assert.equal(value, '\u65e5\u672c\u8a9e');
      continue;
    }
    if (key === 'noscript.ja') {
      assert.equal(value, messages.ja['noscript.ja']);
      continue;
    }
    assert.doesNotMatch(value, JAPANESE, key);
    assert.doesNotMatch(value, /:$/m, key);
  }
  assert.equal(messages.ja.language, 'English');
  /* The theme button says where a click leads: raito (light) or daaku (dark) + ni suru. */
  assert.match(messages.ja['theme.toLight'], /^\u30e9\u30a4\u30c8.*\u306b\u3059\u308b$/);
  assert.match(messages.ja['theme.toDark'], /^\u30c0\u30fc\u30af.*\u306b\u3059\u308b$/);
  assert.match(messages.en['theme.toLight'], /^Switch to light\b/);
  assert.match(messages.en['theme.toDark'], /^Switch to dark\b/);
  /* The privacy line still says that only the language and display settings are stored. */
  assert.match(messages.en.privacy, /Only the language and display settings are stored/);
});

test('Claims do not present the tool as tamper prevention, verification or decryption', () => {
  for (const [key, value] of Object.entries(messages.ja)) assert.doesNotMatch(value, CLAIMS_JA, key);
  for (const [key, value] of Object.entries(messages.en)) assert.doesNotMatch(value, CLAIMS_EN, key);
  assert.match(messages.ja['compare.match'], /\u540c\u3058\u30d0\u30a4\u30c8\u5217/);
  assert.match(messages.en['compare.match'], /same bytes/);
});

test('Preset inputs live outside the dictionary, are identical in both languages and all carry labels', () => {
  const source = read('presets.js');
  assert.doesNotMatch(source, /SHA256ByteMessages|navigator\.|document\.|localStorage/);
  const ids = presets.list.map(preset => preset.id);
  assert.equal(ids.length, new Set(ids).size);
  for (const preset of presets.list) {
    assert.match(preset.id, /^[a-z0-9-]+$/);
    assert.ok(['text', 'hex'].includes(preset.mode), preset.id);
    const hasInput = typeof preset.text === 'string' || typeof preset.hex === 'string' || typeof preset.derive === 'string';
    assert.ok(hasInput, preset.id + ' carries its input');
    for (const lang of ['ja', 'en']) {
      const label = messages[lang]['preset.' + preset.id];
      assert.ok(typeof label === 'string' && label.length > 0, lang + ' label for ' + preset.id);
      assert.ok(messages[lang]['preset.group.' + preset.group], lang + ' group label for ' + preset.group);
    }
  }
  const labels = Object.keys(messages.ja).filter(key => /^preset\.(?!group\.)/.test(key)).map(key => key.slice('preset.'.length));
  assert.deepEqual(labels.sort(), ids.slice().sort(), 'no label without a preset');
});
