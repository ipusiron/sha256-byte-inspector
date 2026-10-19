/* SHA-256 Byte Inspector - MIT (c) 2026 ipusiron
 * Input side of the tool: UTF-8 encoding of a string with newline/BOM options,
 * reading of hexadecimal byte lists, classification of code points, and the
 * URL fragment used to share a view. No DOM access; usable from Node and the
 * browser. The hash itself lives in sha256-core.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SHA256ByteInput = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const encoder = new globalThis.TextEncoder();

  /* Code points that get a dedicated class in the byte grid. Everything else is
   * `control` (Cc), `format` (Cf), `space` (other separators) or `text`. */
  const NAMED_CLASSES = new Map([
    [0x000a, 'lf'], [0x000d, 'cr'], [0x0009, 'tab'], [0x0020, 'space'],
    [0x00a0, 'nbsp'], [0x3000, 'ideographic-space'], [0x200b, 'zwsp'],
    [0x200d, 'zwj'], [0xfe0f, 'vs16'], [0xfeff, 'bom'], [0xfffd, 'replacement']
  ]);
  const CLASSES = Object.freeze(['text', 'lf', 'cr', 'tab', 'space', 'nbsp', 'ideographic-space',
    'zwsp', 'zwj', 'vs16', 'bom', 'replacement', 'lone-surrogate', 'control', 'format']);
  const CONTROL = /^\p{Cc}$/u;
  const FORMAT = /^\p{Cf}$/u;
  const SEPARATOR_CATEGORY = /^\p{Z}$/u;

  /* Names for the invisible characters that matter here (Unicode character
   * names). Any other code point is reported as U+XXXX only. */
  const UNICODE_NAMES = new Map([
    [0x0009, 'CHARACTER TABULATION'], [0x000a, 'LINE FEED'], [0x000d, 'CARRIAGE RETURN'],
    [0x0020, 'SPACE'], [0x00a0, 'NO-BREAK SPACE'], [0x3000, 'IDEOGRAPHIC SPACE'],
    [0xfeff, 'ZERO WIDTH NO-BREAK SPACE'], [0x200b, 'ZERO WIDTH SPACE'],
    [0x200d, 'ZERO WIDTH JOINER'], [0xfe0f, 'VARIATION SELECTOR-16'],
    [0xfffd, 'REPLACEMENT CHARACTER']
  ]);
  const DIGIT_WORDS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
  for (let digit = 0; digit < 10; digit += 1) UNICODE_NAMES.set(0xff10 + digit, 'FULLWIDTH DIGIT ' + DIGIT_WORDS[digit]);

  /* Hex mode: ASCII whitespace and the punctuation of common byte-list formats
   * (Wireshark colons, C arrays, Go/Python literals, xxd -p) split tokens. */
  const HEX_WHITESPACE = new Set([' ', '\t', '\n', '\r', '\u000b', '\u000c']);
  const HEX_SEPARATORS = new Set([',', ':', '-', ';', '{', '}', '[', ']']);
  const DUMP_LINE = /^[0-9a-f]{7,8}:?\s/i;
  const FRAGMENT_KEYS = Object.freeze(['v', 'm', 'in', 'at', 'r', 'l', 'd']);

  function isLoneSurrogateUnit(cp) {
    return cp >= 0xd800 && cp <= 0xdfff;
  }

  function classifyCodePoint(cp) {
    const named = NAMED_CLASSES.get(cp);
    if (named) return named;
    if (isLoneSurrogateUnit(cp)) return 'lone-surrogate';
    const ch = String.fromCodePoint(cp);
    if (CONTROL.test(ch)) return 'control';
    if (FORMAT.test(ch)) return 'format';
    if (SEPARATOR_CATEGORY.test(ch)) return 'space';
    return 'text';
  }

  function codePointLabel(cp) {
    return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
  }

  function unicodeName(cp) {
    const name = UNICODE_NAMES.get(cp);
    return name ? codePointLabel(cp) + ' ' + name : codePointLabel(cp);
  }

  function normalizationStatus(text) {
    const value = String(text);
    const nfc = value.normalize('NFC') === value;
    const nfd = value.normalize('NFD') === value;
    if (nfc && nfd) return 'both';
    if (nfc) return 'nfc';
    if (nfd) return 'nfd';
    return 'neither';
  }

  /* UTF-8 length of one code point. A lone surrogate becomes U+FFFD (3 bytes). */
  function utf8Length(cp, lone) {
    if (lone) return 3;
    if (cp < 0x80) return 1;
    if (cp < 0x800) return 2;
    if (cp < 0x10000) return 3;
    return 4;
  }

  function encodeText(text, options) {
    const opts = options || {};
    const newline = opts.newline === 'crlf' ? 'crlf' : 'lf';
    let out = text == null ? '' : String(text);
    /* `\r?\n` matches an existing CRLF as one unit (kept) or a bare LF (expanded). */
    if (newline === 'crlf') out = out.replace(/\r?\n/g, match => (match === '\n' ? '\r\n' : match));
    if (opts.trailingNewline) out += newline === 'crlf' ? '\r\n' : '\n';
    if (opts.bom) out = '\ufeff' + out;

    const bytes = encoder.encode(out);
    const chars = [];
    let start = 0;
    let lf = 0;
    let cr = 0;
    let crlf = 0;
    let loneSurrogates = 0;
    let pendingCr = false;
    for (const char of out) {
      const cp = char.codePointAt(0);
      const lone = char.length === 1 && isLoneSurrogateUnit(cp);
      if (lone) loneSurrogates += 1;
      if (cp === 0x0d) {
        if (pendingCr) cr += 1;
        pendingCr = true;
      } else {
        if (cp === 0x0a) {
          if (pendingCr) crlf += 1;
          else lf += 1;
        } else if (pendingCr) {
          cr += 1;
        }
        pendingCr = false;
      }
      const length = utf8Length(cp, lone);
      chars.push({ index: chars.length, cp, char, start, length, cls: lone ? 'lone-surrogate' : classifyCodePoint(cp) });
      start += length;
    }
    if (pendingCr) cr += 1;
    if (start !== bytes.length) throw new Error('byteLayoutMismatch');

    const stats = {
      codePoints: chars.length,
      utf16Units: out.length,
      byteCount: bytes.length,
      lf,
      cr,
      crlf,
      trailingNewline: out.endsWith('\r\n') ? 'crlf' : (out.endsWith('\n') ? 'lf' : 'none'),
      loneSurrogates,
      bom: out.charCodeAt(0) === 0xfeff,
      normalization: normalizationStatus(out)
    };
    return { text: out, bytes, stats, chars };
  }

  function isHexDigit(code) {
    return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x46) || (code >= 0x61 && code <= 0x66);
  }

  function hexError(code, position, line, column, char, token, tokenStart) {
    const codePoint = char.codePointAt(0);
    return { ok: false, error: { code, position, line, column, char, codePoint, name: unicodeName(codePoint), token, tokenStart } };
  }

  /* Reads one token (no separators inside). `start` is the token's first code
   * point: {index, line, column}. Returns {prefix, hex} or an error result. */
  function readHexToken(raw, start, removed) {
    let prefix = '';
    if (raw.length > 2 && ((raw[0] === '0' && (raw[1] === 'x' || raw[1] === 'X')) || (raw[0] === '\\' && raw[1] === 'x'))) {
      prefix = raw.slice(0, 2);
    }
    const body = raw.slice(prefix.length);
    let digits = 0;
    let uppercase = 0;
    for (const char of body) {
      const code = char.codePointAt(0);
      if (!isHexDigit(code)) {
        const position = start.index + prefix.length + digits;
        return hexError('invalid-char', position, start.line, start.column + prefix.length + digits, char, raw, start.index);
      }
      if (code >= 0x41 && code <= 0x46) uppercase += 1;
      digits += 1;
    }
    if (digits % 2 === 1) {
      const position = start.index + prefix.length + digits - 1;
      return hexError('odd-length', position, start.line, start.column + prefix.length + digits - 1, body[digits - 1], raw, start.index);
    }
    if (prefix === '\\x') removed.prefixBackslashX += 1;
    else if (prefix) removed.prefix0x += 1;
    removed.uppercase += uppercase;
    return { prefix, hex: body.toLowerCase() };
  }

  function parseHex(text) {
    const source = text == null ? '' : String(text);
    const warnings = [];
    if (source.split(/\r\n|\r|\n/).some(line => DUMP_LINE.test(line))) warnings.push('dump-like');
    const removed = { prefix0x: 0, prefixBackslashX: 0, separators: 0, whitespace: 0, uppercase: 0 };
    const tokens = [];
    const bytes = [];
    let index = 0;
    let line = 1;
    let column = 1;
    let pendingCr = false;
    let token = '';
    let tokenStart = null;

    const flush = () => {
      if (token === '') return null;
      const read = readHexToken(token, tokenStart, removed);
      if (read.ok === false) return read;
      tokens.push({ start: tokenStart.index, end: tokenStart.index + token.length, raw: token, prefix: read.prefix, hex: read.hex, count: read.hex.length / 2 });
      for (let i = 0; i < read.hex.length; i += 2) bytes.push(parseInt(read.hex.slice(i, i + 2), 16));
      token = '';
      tokenStart = null;
      return null;
    };

    for (const char of source) {
      if (HEX_WHITESPACE.has(char) || HEX_SEPARATORS.has(char)) {
        const failure = flush();
        if (failure) return Object.assign(failure, { warnings });
        if (HEX_WHITESPACE.has(char)) removed.whitespace += 1;
        else removed.separators += 1;
      } else {
        if (char === '\\' && token !== '') {
          /* A backslash can only start a `\x` prefix, so it also ends the
           * previous token: `\x7b\x7b` is two bytes (same reading as CyberChef). */
          const failure = flush();
          if (failure) return Object.assign(failure, { warnings });
        }
        if (tokenStart === null) tokenStart = { index, line, column };
        token += char;
      }
      index += 1;
      if (char === '\r') {
        line += 1;
        column = 1;
        pendingCr = true;
      } else if (char === '\n') {
        if (!pendingCr) line += 1;
        column = 1;
        pendingCr = false;
      } else {
        column += 1;
        pendingCr = false;
      }
    }
    const failure = flush();
    if (failure) return Object.assign(failure, { warnings });

    const out = Uint8Array.from(bytes);
    if (tokens.length === 1 && tokens[0].hex.length === 64) warnings.push('hash-like');
    return { ok: true, bytes: out, normalized: hexBytes(out), tokens, removed, warnings };
  }

  function hexBytes(bytes) {
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(' ');
  }

  /* Reads `#v=1&m=t&in=...&at=...&r=...&l=...&d=...` and the Day117 style
   * `#text=...` / `#hex=...`. Keys and values are percent-decoded; a part that
   * fails to decode is dropped and `error` is set. `+` stays `+`. */
  function parseFragment(hash) {
    const result = { text: null, hex: null, at: null, r: null, l: null, m: null, d: null, v: null, error: false };
    let source = hash == null ? '' : String(hash);
    if (source.startsWith('#')) source = source.slice(1);
    let mode = null;
    let input = null;
    for (const part of source.split('&')) {
      if (part === '') continue;
      const eq = part.indexOf('=');
      const rawKey = eq < 0 ? part : part.slice(0, eq);
      const rawValue = eq < 0 ? '' : part.slice(eq + 1);
      let key;
      let value;
      try {
        key = decodeURIComponent(rawKey);
        value = decodeURIComponent(rawValue);
      } catch (error) {
        result.error = true;
        continue;
      }
      if (key === 'text') result.text = value;
      else if (key === 'hex') result.hex = value;
      else if (key === 'in') input = value;
      else if (key === 'm') mode = value;
      else if (key === 'v' || key === 'at' || key === 'r' || key === 'l' || key === 'd') result[key] = value;
    }
    if (input !== null) {
      if (mode === 'x') result.hex = input;
      else result.text = input;
    }
    if (mode === 't' || mode === 'x') result.m = mode;
    else if (result.hex !== null && result.text === null) result.m = 'x';
    else if (result.text !== null) result.m = 't';
    return result;
  }

  /* Builds the fragment for "copy link". Accepts {text} or {hex} (or explicit
   * {m, in}) plus at, r, l, d. A value that encodeURIComponent rejects (a lone
   * surrogate) is left out and `error` is set. The result stringifies to the
   * fragment so it can be appended to a URL directly. */
  function buildFragment(params) {
    const p = params || {};
    let mode = p.m === 't' || p.m === 'x' ? p.m : null;
    let input = typeof p.in === 'string' ? p.in : null;
    if (input === null) {
      if (typeof p.text === 'string') {
        mode = 't';
        input = p.text;
      } else if (typeof p.hex === 'string') {
        mode = 'x';
        input = p.hex;
      }
    }
    const values = { v: p.v == null ? '1' : String(p.v), m: mode, in: input, at: p.at, r: p.r, l: p.l, d: p.d };
    const parts = [];
    const omitted = [];
    for (const key of FRAGMENT_KEYS) {
      const value = values[key];
      if (value === undefined || value === null) continue;
      try {
        parts.push(key + '=' + encodeURIComponent(String(value)));
      } catch (error) {
        omitted.push(key);
      }
    }
    const fragment = '#' + parts.join('&');
    return { fragment, error: omitted.length > 0, omitted, toString: () => fragment };
  }

  function sha256sumLine(digestHex) {
    return String(digestHex).toLowerCase() + '  -';
  }

  return Object.freeze({ CLASSES, FRAGMENT_KEYS, encodeText, parseHex, classifyCodePoint, unicodeName,
    normalizationStatus, parseFragment, buildFragment, sha256sumLine, hexBytes });
}));
