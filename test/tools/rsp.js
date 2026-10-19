/* Reader for the NIST CAVP SHA-256 response files (.rsp) in test/vectors/nist-cavp.
 *
 * The files are data: every line is matched against a fixed pattern and nothing
 * in them is executed. Comment lines (`#`), blank lines and bracketed parameter
 * lines such as `[L = 32]` are skipped. Lines end with CRLF in the originals.
 *
 * parseMsgFile(text)  -> [{len, msg: Uint8Array, md}]  for SHA256ShortMsg.rsp and
 *                        SHA256LongMsg.rsp. `len` is the message length in bits,
 *                        `msg` the message bytes and `md` the digest as lowercase
 *                        hex. The record with Len = 0 prints `Msg = 00` but means
 *                        the empty message, so its `msg` is an empty Uint8Array.
 * parseMonte(text)    -> {seed, checkpoints: [{count, md}]}  for SHA256Monte.rsp,
 *                        hex in lowercase. The checkpoints follow SHAVS section
 *                        6.4: for each checkpoint j, MD0 = MD1 = MD2 = seed; for
 *                        i = 3..1002, Mi = MD[i-3] || MD[i-2] || MD[i-1] and
 *                        MDi = SHA-256(Mi); the checkpoint is MD1002, which also
 *                        becomes the seed of checkpoint j + 1. */
'use strict';

const DIGEST_HEX = /^[0-9A-Fa-f]{64}$/;

function splitLines(text) {
  return String(text).split(/\r?\n/);
}

function skippable(line) {
  return line === '' || line.startsWith('#') || (line.startsWith('[') && line.endsWith(']'));
}

function hexToBytes(hex) {
  if (hex.length % 2 !== 0 || !/^[0-9A-Fa-f]*$/.test(hex)) throw new Error('Invalid hex string: ' + hex);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function fields(text) {
  const result = [];
  splitLines(text).forEach((raw, index) => {
    const line = raw.trim();
    if (skippable(line)) return;
    const match = /^([A-Za-z]+)\s*=\s*(\S+)$/.exec(line);
    if (!match) throw new Error(`Line ${index + 1}: unexpected content`);
    result.push({ key: match[1], value: match[2], line: index + 1 });
  });
  return result;
}

function parseMsgFile(text) {
  const records = [];
  let current = null;
  for (const { key, value, line } of fields(text)) {
    if (key === 'Len') {
      if (current) throw new Error(`Line ${line}: Len before the previous record was completed`);
      if (!/^\d+$/.test(value)) throw new Error(`Line ${line}: Len is not a number`);
      const len = Number(value);
      if (len % 8 !== 0) throw new Error(`Line ${line}: Len ${len} is not a whole number of bytes`);
      current = { len };
    } else if (key === 'Msg') {
      if (!current || current.msg) throw new Error(`Line ${line}: Msg without a preceding Len`);
      if (current.len === 0) {
        current.msg = new Uint8Array(0);
      } else {
        if (value.length !== current.len / 4) {
          throw new Error(`Line ${line}: Msg has ${value.length} hex digits but Len = ${current.len} bits needs ${current.len / 4}`);
        }
        current.msg = hexToBytes(value);
      }
    } else if (key === 'MD') {
      if (!current || !current.msg) throw new Error(`Line ${line}: MD without a preceding Msg`);
      if (!DIGEST_HEX.test(value)) throw new Error(`Line ${line}: MD is not 64 hex digits`);
      current.md = value.toLowerCase();
      records.push(current);
      current = null;
    } else {
      throw new Error(`Line ${line}: unknown field ${key}`);
    }
  }
  if (current) throw new Error('Incomplete record at the end of the file');
  if (records.length === 0) throw new Error('No records found');
  return records;
}

function parseMonte(text) {
  let seed = null;
  let count = null;
  const checkpoints = [];
  for (const { key, value, line } of fields(text)) {
    if (key === 'Seed') {
      if (seed !== null) throw new Error(`Line ${line}: second Seed`);
      if (!DIGEST_HEX.test(value)) throw new Error(`Line ${line}: Seed is not 64 hex digits`);
      seed = value.toLowerCase();
    } else if (key === 'COUNT') {
      if (seed === null) throw new Error(`Line ${line}: COUNT before Seed`);
      if (count !== null) throw new Error(`Line ${line}: COUNT without an MD for the previous COUNT`);
      if (!/^\d+$/.test(value) || Number(value) !== checkpoints.length) {
        throw new Error(`Line ${line}: COUNT must be ${checkpoints.length}`);
      }
      count = Number(value);
    } else if (key === 'MD') {
      if (count === null) throw new Error(`Line ${line}: MD without a preceding COUNT`);
      if (!DIGEST_HEX.test(value)) throw new Error(`Line ${line}: MD is not 64 hex digits`);
      checkpoints.push({ count, md: value.toLowerCase() });
      count = null;
    } else {
      throw new Error(`Line ${line}: unknown field ${key}`);
    }
  }
  if (seed === null) throw new Error('No Seed found');
  if (count !== null) throw new Error('COUNT without MD at the end of the file');
  if (checkpoints.length === 0) throw new Error('No checkpoints found');
  return { seed, checkpoints };
}

module.exports = { parseMsgFile, parseMonte, hexToBytes };
