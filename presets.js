/* SHA-256 Byte Inspector - MIT (c) 2026 ipusiron
 * Preset inputs shared by both languages. Labels live in messages.js (preset.<id>).
 * Non-ASCII sample text is written with escapes so the source stays ASCII. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SHA256BytePresets = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const text = (id, group, value, extra) => Object.assign({ id, group, mode: 'text', text: value }, extra || {});
  const hex = (id, group, value, extra) => Object.assign({ id, group, mode: 'hex', hex: value }, extra || {});

  /* Day117 Hash Chain Tamper Trainer, sample "access" (fictional, ASCII only). */
  const day117 = {
    headers: ['# kind=fictional-access', '# started=09:00', '# format=hctt/1'],
    rows: [
      ['09:02', 'Room-A', 'C-1001', 'IN'],
      ['09:05', 'Room-B', 'C-1002', 'IN'],
      ['09:12', 'Room-A', 'C-1001', 'OUT'],
      ['09:20', 'Room-C', 'C-1003', 'IN'],
      ['09:25', 'Room-B', 'C-1002', 'OUT'],
      ['09:30', 'Room-A', 'C-1004', 'IN'],
      ['09:42', 'Room-C', 'C-1003', 'OUT'],
      ['09:50', 'Room-A', 'C-1004', 'OUT']
    ],
    fixedSeed: '0'.repeat(64),
    /* Builds the five reproduction inputs. `digestHexOf(text)` must return the
     * lowercase SHA-256 of the UTF-8 bytes of `text` (synchronous). */
    build(digestHexOf) {
      const seedInput = day117.headers.join('\n');
      const seed = digestHexOf(seedInput);
      const rowInput = (previous, fields) => previous + '|' + fields.join(',');
      let previous = seed;
      const rowInputs = [];
      const hashes = [];
      for (const fields of day117.rows) {
        const input = rowInput(previous, fields);
        rowInputs.push(input);
        previous = digestHexOf(input);
        hashes.push(previous);
      }
      const modified = day117.rows[1].slice();
      modified[0] = '09:06';
      return {
        seed: seedInput,
        row1: rowInputs[0],
        row2modified: rowInput(hashes[0], modified),
        trailer: previous + '|rows=' + day117.rows.length,
        noHeaderRow1: rowInput(day117.fixedSeed, day117.rows[0]),
        hashes: { seed, rows: hashes }
      };
    }
  };

  const list = [
    /* basic */
    text('empty', 'basic', ''),
    text('abc', 'basic', 'abc'),
    text('nist-two-block', 'basic', 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    text('a-55', 'basic', 'a'.repeat(55)),
    text('a-56', 'basic', 'a'.repeat(56), { pair: 'a-55' }),
    text('a-64', 'basic', 'a'.repeat(64)),
    /* bytes vs text */
    text('text-7b', 'bytes', '7b'),
    hex('hex-7b', 'bytes', '7b', { pair: 'text-7b' }),
    text('brace', 'bytes', '{', { pair: 'hex-7b' }),
    hex('hex-616263', 'bytes', '61 62 63', { pair: 'abc' }),
    hex('hex-bd', 'bytes', 'bd'),
    /* newlines */
    text('abc-lf', 'newline', 'abc', { options: { trailingNewline: true }, pair: 'abc' }),
    text('abc-crlf', 'newline', 'abc', { options: { newline: 'crlf', trailingNewline: true }, pair: 'abc' }),
    text('ab-lf', 'newline', 'a\nb'),
    text('ab-crlf', 'newline', 'a\nb', { options: { newline: 'crlf' }, pair: 'ab-lf' }),
    text('ab-cr', 'newline', 'a\rb', { pair: 'ab-lf' }),
    text('abc-bom', 'newline', 'abc', { options: { bom: true }, pair: 'abc' }),
    /* unicode */
    text('ga-nfc', 'unicode', '\u304c'),
    text('ga-nfd', 'unicode', '\u304b\u3099', { pair: 'ga-nfc' }),
    text('e-acute-nfc', 'unicode', '\u00e9'),
    text('e-acute-nfd', 'unicode', 'e\u0301', { pair: 'e-acute-nfc' }),
    text('latin-a', 'unicode', 'A'),
    text('fullwidth-a', 'unicode', '\uff21', { pair: 'latin-a' }),
    text('latin-small-a', 'unicode', 'a'),
    text('cyrillic-a', 'unicode', '\u0430', { pair: 'latin-small-a' }),
    text('ab', 'unicode', 'ab'),
    text('ab-zwsp', 'unicode', 'a\u200bb', { pair: 'ab' }),
    text('heart', 'unicode', '\u2764'),
    text('heart-vs16', 'unicode', '\u2764\ufe0f', { pair: 'heart' }),
    text('space-ascii', 'unicode', 'a b'),
    text('space-ideographic', 'unicode', 'a\u3000b', { pair: 'space-ascii' }),
    text('space-nbsp', 'unicode', 'a\u00a0b', { pair: 'space-ascii' }),
    text('digit-one', 'unicode', '1'),
    text('circled-one', 'unicode', '\u2460', { pair: 'digit-one' }),
    text('family-zwj', 'unicode', '\u{1f468}\u200d\u{1f469}\u200d\u{1f467}'),
    text('family-no-zwj', 'unicode', '\u{1f468}\u{1f469}\u{1f467}', { pair: 'family-zwj' }),
    text('hiragana-a', 'unicode', '\u3042'),
    text('emoji-grin', 'unicode', '\u{1f600}'),
    text('lone-surrogate', 'unicode', 'a\ud83db'),
    /* Day117 reproduction (built at runtime, see day117.build) */
    { id: 'day117-seed', group: 'day117', mode: 'text', derive: 'seed' },
    { id: 'day117-row1', group: 'day117', mode: 'text', derive: 'row1' },
    { id: 'day117-row2-modified', group: 'day117', mode: 'text', derive: 'row2modified' },
    { id: 'day117-trailer', group: 'day117', mode: 'text', derive: 'trailer' },
    { id: 'day117-no-header-row1', group: 'day117', mode: 'text', derive: 'noHeaderRow1' }
  ];

  return Object.freeze({ list, day117 });
}));
