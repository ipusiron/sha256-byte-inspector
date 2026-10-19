/* Boundary values added by the review of sha256-core.js and input-core.js: the
 * 64 KiB input limit, zero-filled and 0xff-filled messages around the block
 * boundaries, a 1,025-block trace, lone surrogates at the edges of a string,
 * CR without LF, invisible characters at the edges of a hex token, and the URL
 * fragment with CRLF and "+". Every digest is computed by node:crypto while the
 * test runs; the only literals are lengths, counts and positions. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const core = require('../sha256-core.js');
const input = require('../input-core.js');

const LIMIT = 65536;
const nodeHex = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hexWords = words => Array.from(words, core.hexWord).join('');

function checkChain(result) {
  let previous = core.H0;
  for (let b = 0; b < result.blocks; b += 1) {
    const trace = core.traceBlock(result, b);
    assert.deepEqual(trace.Hin, Uint32Array.from(previous), `block ${b}: Hin`);
    assert.deepEqual(trace.Hout, result.Hin.slice(8 * (b + 1), 8 * (b + 2)), `block ${b}: Hout`);
    previous = trace.Hout;
  }
  assert.equal(hexWords(previous), result.digestHex);
}

test('Zero-filled and 0xff-filled messages of 0 to 129 bytes around every block boundary match node:crypto', () => {
  for (const n of [0, 1, 54, 55, 56, 57, 63, 64, 65, 118, 119, 120, 121, 127, 128, 129]) {
    for (const fill of [0x00, 0xff]) {
      const bytes = new Uint8Array(n).fill(fill);
      const result = core.hash(bytes);
      assert.equal(result.digestHex, nodeHex(bytes), `${n} bytes of ${fill}`);
      assert.equal(result.blocks, Math.floor((n + 8) / 64) + 1);
      assert.equal(result.padded[n], 0x80);
      assert.ok(result.padded.subarray(n + 1, result.padded.length - 8).every(byte => byte === 0));
      assert.equal(new DataView(result.padded.buffer).getBigUint64(result.padded.length - 8), BigInt(n) * 8n);
      checkChain(result);
    }
  }
});

test('The 64 KiB limit: 65,536 bytes of text, of hex and of 4-byte characters hash in 1,025 blocks', () => {
  const text = input.encodeText('a'.repeat(LIMIT));
  assert.equal(text.stats.byteCount, LIMIT);
  const result = core.hash(text.bytes);
  assert.equal(result.blocks, 1025);
  assert.equal(result.digestHex, nodeHex(text.bytes));
  checkChain(result);

  const random = crypto.randomBytes(LIMIT);
  const hex = input.parseHex(random.toString('hex'));
  assert.equal(hex.ok, true);
  assert.equal(hex.bytes.length, LIMIT);
  assert.deepEqual(hex.warnings, []);
  assert.equal(core.hash(hex.bytes).digestHex, nodeHex(random));
  assert.equal(hex.normalized, core.hexBytes(random, ' '));

  const emoji = input.encodeText('\u{1f600}'.repeat(LIMIT / 4));
  assert.deepEqual([emoji.stats.codePoints, emoji.stats.utf16Units, emoji.stats.byteCount], [LIMIT / 4, LIMIT / 2, LIMIT]);
  assert.equal(core.hash(emoji.bytes).digestHex, nodeHex(Buffer.from('\u{1f600}'.repeat(LIMIT / 4), 'utf8')));

  const total = core.stepCount(1025);
  assert.equal(total, 1 + 1025 * 114 + 1);
  assert.equal(core.positionId(core.stepAt(1025, total - 2)), 'b1025.add');
  assert.equal(core.stepOf(1025, core.parsePositionId('b1025.add')), total - 2);
  assert.deepEqual(core.stepAt(1025, total - 1), { phase: 'digest', block: null, index: 0 });
});

test('hexBytes treats a missing or null separator as none', () => {
  const bytes = Uint8Array.from([0, 15, 255]);
  assert.equal(core.hexBytes(bytes), '000fff');
  assert.equal(core.hexBytes(bytes, undefined), '000fff');
  assert.equal(core.hexBytes(bytes, null), '000fff');
  assert.equal(core.hexBytes(bytes, ''), '000fff');
});

test('Lone surrogates at the start, the end and in pairs encode like Buffer.from and are all counted', () => {
  for (const text of ['\ud800', '\udc00', '\ud800abc', 'abc\ud800', 'a\ud800\ud800b', '\u{1f600}\ud83d', '\ude00\ud83d']) {
    const result = input.encodeText(text);
    const reference = Buffer.from(text, 'utf8');
    assert.equal(Buffer.from(result.bytes).toString('hex'), reference.toString('hex'), JSON.stringify(text));
    assert.equal(core.hash(result.bytes).digestHex, nodeHex(reference));
    const expected = Array.from(text).filter(ch => ch.length === 1 && ch.codePointAt(0) >= 0xd800 && ch.codePointAt(0) <= 0xdfff).length;
    assert.equal(result.stats.loneSurrogates, expected, JSON.stringify(text));
    assert.equal(result.chars.filter(c => c.cls === 'lone-surrogate').length, expected);
  }
  const mixed = input.encodeText('a\u3042\u{1f600}\ud800z');
  assert.deepEqual(mixed.chars.map(c => c.length), [1, 3, 4, 3, 1]);
  assert.deepEqual(mixed.chars.map(c => c.start), [0, 1, 4, 8, 11]);
});

test('CR without LF stays one byte, counts as a lone CR and is completed to CRLF only by trailingNewline', () => {
  const alone = input.encodeText('\r');
  assert.deepEqual([alone.stats.byteCount, alone.stats.cr, alone.stats.lf, alone.stats.crlf, alone.stats.trailingNewline], [1, 1, 0, 0, 'none']);
  assert.equal(core.hash(alone.bytes).digestHex, nodeHex(Buffer.from('\r')));
  for (const text of ['\r', 'a\r', '\ra', 'a\rb\r', '\n\r', '\r\r', '\r\n\r']) {
    const kept = input.encodeText(text, { newline: 'crlf' });
    assert.equal(kept.text, text.replace(/\r?\n/g, match => (match === '\n' ? '\r\n' : match)), JSON.stringify(text));
    assert.equal(Buffer.from(input.encodeText(text).bytes).toString('hex'), Buffer.from(text, 'utf8').toString('hex'));
  }
  const completed = input.encodeText('a\r', { trailingNewline: true });
  assert.equal(completed.text, 'a\r\n');
  assert.deepEqual([completed.stats.cr, completed.stats.crlf, completed.stats.trailingNewline], [0, 1, 'crlf']);
});

test('parseHex rejects U+3000 and U+FEFF at the start, inside and at the end of the input, and warns on a 0x-prefixed digest', () => {
  for (const [text, position, codePoint] of [['\ufeff7b7b', 0, 0xfeff], ['7b\ufeff7b', 2, 0xfeff], ['7b7b\ufeff', 4, 0xfeff],
    ['\u30007b7b', 0, 0x3000], ['7b\u30007b', 2, 0x3000], ['7b7b\u3000', 4, 0x3000]]) {
    const result = input.parseHex(text);
    assert.equal(result.ok, false, JSON.stringify(text));
    assert.deepEqual([result.error.code, result.error.position, result.error.codePoint], ['invalid-char', position, codePoint], JSON.stringify(text));
  }
  const digest = nodeHex(Buffer.from('abc'));
  const prefixed = input.parseHex('0x' + digest);
  assert.equal(prefixed.ok, true);
  assert.deepEqual(prefixed.warnings, ['hash-like']);
  assert.equal(Buffer.from(prefixed.bytes).toString('hex'), digest);
  assert.equal(input.parseHex('\r').ok, true);
  assert.equal(input.parseHex('7b\r\n7b').tokens.length, 2);
});

test('Fragment: %0D%0A arrives as CRLF, + stays +, and the built fragment never contains a raw + or space', () => {
  assert.equal(input.parseFragment('#v=1&m=t&in=a%0D%0Ab+c').text, 'a\r\nb+c');
  assert.equal(input.parseFragment('#in=a+b').text, 'a+b');
  assert.equal(input.parseFragment('#in=a%2Bb').text, 'a+b');
  assert.equal(input.parseFragment('#in=a%23b').text, 'a#b');
  const built = input.buildFragment({ text: 'a\r\nb+c d' });
  assert.equal(built.fragment, '#v=1&m=t&in=a%0D%0Ab%2Bc%20d');
  assert.equal(input.parseFragment(built.fragment).text, 'a\r\nb+c d');
  assert.equal(input.encodeText(input.parseFragment(built.fragment).text).stats.crlf, 1);
});
