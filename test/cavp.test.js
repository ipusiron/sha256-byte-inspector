/* NIST CAVP byte-oriented SHA-256 vectors (test/vectors/nist-cavp) recomputed with the
 * pure JavaScript core: SHA256ShortMsg.rsp (65 messages), SHA256LongMsg.rsp (64) and
 * SHA256Monte.rsp (100 checkpoints of the SHAVS 6.4 Monte Carlo procedure). The .rsp
 * files are read as data by test/tools/rsp.js. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../sha256-core.js');
const rsp = require('./tools/rsp.js');

const CAVP = path.join(__dirname, 'vectors', 'nist-cavp');
const read = name => fs.readFileSync(path.join(CAVP, name), 'utf8');
const nodeHex = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

for (const [file, count, minBits, maxBits] of [['SHA256ShortMsg.rsp', 65, 0, 512], ['SHA256LongMsg.rsp', 64, 1304, 51200]]) {
  test(`CAVP ${file}: ${count} messages, Len ${minBits} to ${maxBits} bits`, () => {
    const records = rsp.parseMsgFile(read(file));
    assert.equal(records.length, count);
    assert.equal(records[0].len, minBits);
    assert.equal(records[records.length - 1].len, maxBits);
    for (const { len, msg, md } of records) {
      assert.equal(msg.length * 8, len);
      const result = core.hash(msg);
      assert.equal(result.digestHex, md, `Len = ${len}`);
      assert.equal(result.blocks, core.blockCount(msg.length));
      assert.equal(nodeHex(msg), md, `Len = ${len} (node:crypto)`);
    }
    if (minBits === 0) {
      assert.equal(records[0].msg.length, 0, 'Len = 0 is the empty message');
      assert.equal(core.hash(new Uint8Array(0)).digestHex, records[0].md);
    }
  });
}

test('CAVP SHA256Monte.rsp: 100 checkpoints by the SHAVS 6.4 procedure', () => {
  const { seed, checkpoints } = rsp.parseMonte(read('SHA256Monte.rsp'));
  assert.equal(seed.length, 64);
  assert.equal(checkpoints.length, 100);
  /* For each checkpoint j: MD0 = MD1 = MD2 = Seed; for i = 3..1002,
   * Mi = MD[i-3] || MD[i-2] || MD[i-1] and MDi = SHA-256(Mi); the checkpoint is
   * MD1002, which seeds checkpoint j + 1. */
  let current = rsp.hexToBytes(seed);
  checkpoints.forEach((checkpoint, j) => {
    assert.equal(checkpoint.count, j);
    let md = [current, current, current];
    for (let i = 3; i <= 1002; i += 1) {
      const message = new Uint8Array(96);
      message.set(md[0], 0);
      message.set(md[1], 32);
      message.set(md[2], 64);
      md = [md[1], md[2], core.hash(message).digest];
    }
    current = md[2];
    assert.equal(core.hexBytes(current), checkpoint.md, `COUNT = ${j}`);
  });
});
