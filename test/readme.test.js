'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const core = require('../sha256-core.js');
const presets = require('../presets.js');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const docs = ['README.md', 'README.en.md'].map(read);
const headings = [
  ['\u{1f310} \u30c7\u30e2\u30da\u30fc\u30b8', '\u{1f4f8} \u30b9\u30af\u30ea\u30fc\u30f3\u30b7\u30e7\u30c3\u30c8', '\u2728 \u6a5f\u80fd', '\u{1f4d6} \u4f7f\u3044\u65b9', '\u{1f52c} SHA-256\u306e\u8a08\u7b97\u3068\u691c\u7b97', '\u{1f3af} \u30e6\u30fc\u30b9\u30b1\u30fc\u30b9', '\u26a0\ufe0f \u5236\u7d04\u3068\u524d\u63d0', '\u{1f512} \u30d7\u30e9\u30a4\u30d0\u30b7\u30fc\u3068\u5b89\u5168\u5bfe\u7b56', '\u{1f517} \u53c2\u8003\u6587\u732e\u3068\u95a2\u9023\u30c4\u30fc\u30eb', '\u{1f9ea} \u30c6\u30b9\u30c8', '\u{1f4c1} \u30c7\u30a3\u30ec\u30af\u30c8\u30ea\u30fc\u69cb\u9020', '\u{1f4bb} \u52d5\u4f5c\u74b0\u5883', '\u{1f4c4} \u30e9\u30a4\u30bb\u30f3\u30b9', '\u{1f6e0}\ufe0f \u3053\u306e\u30c4\u30fc\u30eb\u306b\u3064\u3044\u3066'],
  ['\u{1f310} Demo', '\u{1f4f8} Screenshots', '\u2728 Features', '\u{1f4d6} Usage', '\u{1f52c} SHA-256 computation and checks', '\u{1f3af} Use cases', '\u26a0\ufe0f Limits and assumptions', '\u{1f512} Privacy and security', '\u{1f517} References and related tools', '\u{1f9ea} Tests', '\u{1f4c1} Directory structure', '\u{1f4bb} Requirements', '\u{1f4c4} License', '\u{1f6e0}\ufe0f About this tool']
];

function files(dir = root, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.name === '.git' || entry.name === 'node_modules' ? [] :
    entry.isDirectory() ? files(path.join(dir, entry.name), prefix + entry.name + '/') : [prefix + entry.name]);
}

test('Readme headings, five badges, the day and the project page follow the same order in both languages', () => {
  docs.forEach((doc, i) => {
    assert.deepEqual([...doc.matchAll(/^## (.+)$/gm)].map(m => m[1]), headings[i]);
    assert.equal((doc.match(/https:\/\/img\.shields\.io\//g) || []).length, 5);
    assert.match(doc, /Day118/);
    assert.match(doc, /page_id=44607/);
    assert.doesNotMatch(doc, /^### /m);
    assert.match(doc, /!\[[^\]]+\]\(assets\/demo-rounds\.gif\)/, 'the animation is shown near the top');
  });
});

test('Screenshots have captions, are 1280x800 PNG files under 300KB and every PNG is used', () => {
  const used = [];
  docs.forEach((doc, i) => {
    const images = [...doc.matchAll(/!\[([^\]]+)\]\((assets\/[^)]+\.png)\)\n\n\*([^*]+)\*/g)];
    assert.equal(images.length, i === 0 ? 5 : 4);
    for (const [, alt, file, caption] of images) {
      assert.ok(alt && caption);
      const png = fs.readFileSync(path.join(root, file));
      assert.equal(png.readUInt32BE(16), 1280, file);
      assert.equal(png.readUInt32BE(20), 800, file);
      assert.ok(png.length <= 300000, file);
      used.push(file);
    }
  });
  assert.deepEqual(used.sort(), files().filter(f => f.endsWith('.png')).sort());
  const gif = fs.readFileSync(path.join(root, 'assets/demo-rounds.gif'));
  assert.equal(gif.subarray(0, 6).toString('latin1'), 'GIF89a');
  assert.ok(gif.length <= 1000000, 'the animation stays under 1MB');
});

test('Directory trees list every real file, with aligned descriptions on every line', () => {
  docs.forEach(doc => {
    const tree = /```text\n([\s\S]*?)\n```/.exec(doc)[1].split('\n');
    const listed = [];
    let stack = [];
    const positions = new Set();
    for (const line of tree) {
      assert.match(line, /# \S/);
      positions.add(line.indexOf('#'));
      const item = line.split('#')[0].trimEnd();
      if (item === 'sha256-byte-inspector/') continue;
      const match = /^((?:\u2502   |    )*)(?:\u251c\u2500\u2500 |\u2514\u2500\u2500 )(.+)$/.exec(item);
      assert.ok(match, item);
      const depth = match[1].length / 4;
      stack = stack.slice(0, depth);
      if (match[2].endsWith('/')) stack.push(match[2].slice(0, -1));
      else listed.push([...stack, match[2]].join('/'));
    }
    assert.equal(positions.size, 1);
    assert.deepEqual(listed.sort(), files().sort());
  });
});

test('Required public metadata has exact identifiers and categories', () => {
  const yaml = /^<!--\n---\n([\s\S]*?)\n---\n-->/.exec(docs[0])[1];
  const values = Object.fromEntries(yaml.split('\n').map(line => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trim()]));
  assert.deepEqual(Object.keys(values), ['id', 'slug', 'title', 'subtitle_ja', 'subtitle_en', 'description_ja', 'description_en', 'category_ja', 'category_en', 'difficulty', 'tags', 'repo_url', 'demo_url', 'hub']);
  assert.equal(values.id, 'day118');
  assert.equal(values.slug, 'sha256-byte-inspector');
  assert.equal(values.category_ja, '[\u30cf\u30c3\u30b7\u30e5\u95a2\u6570, \u73fe\u4ee3\u6697\u53f7]');
  assert.equal(values.category_en, '[Hash Function, Modern Cryptography]');
  assert.equal(values.hub, 'true');
  assert.equal(values.repo_url, '"https://github.com/ipusiron/sha256-byte-inspector"');
  assert.equal(values.demo_url, '"https://ipusiron.github.io/sha256-byte-inspector/"');
  assert.match(values.difficulty, /^[1-5]$/);
  for (const value of Object.values(values)) assert.ok(value);
  assert.doesNotMatch(docs[1], /^<!--/);
});

test('Japanese spelling, spacing, claim limits and bold counts stay within the writing rules', () => {
  for (const text of [docs[0], read('CLAUDE.md')]) {
    assert.doesNotMatch(text, /\u65e2\u306b|\u5168\u3066|\u5206\u304b\u308b|\u7121\u3044|\u30a4\u30f3\u30bf\u30fc\u30d5\u30a7\u30fc\u30b9|\d+(?:\u304b\u6240|\u7b87\u6240)|\u306b\u9650\u308b|\u60f3\u5b9a\u3057\u3066\u3044\u306a\u3044|\u52b9\u304f|\u8d70\u308b|\u7167\u5408|\u7a81\u304d\u5408\u308f\u305b|\u6ce8\u76ee\u3059\u3079\u304d|\u3053\u3053\u3067\u91cd\u8981\u306a\u306e\u306f/);
    assert.doesNotMatch(text, /\u6539\u3056\u3093\u3092\u9632\u3050|\u6539\u3056\u3093\u9632\u6b62|\u6539\u3056\u3093\u306e\u8a3c\u660e|\u691c\u8a3c\u30c4\u30fc\u30eb|\u539f\u50cf\u3092\u6c42\u3081\u308b/);
    assert.doesNotMatch(text, /[\u3040-\u30ff\u3400-\u9fff] +[A-Za-z0-9]|[A-Za-z0-9] +[\u3040-\u30ff\u3400-\u9fff]/);
    assert.doesNotMatch(text, /\uff1a$/m);
  }
  for (const doc of docs) for (const section of doc.split(/^## /m)) assert.ok((section.match(/\*\*[^*]+\*\*/g) || []).length <= 2);
  assert.doesNotMatch(docs[1].split('\n').slice(1).join('\n'), /[\u3000-\u303f\u3040-\u30ff\u3400-\u9fff]/);
});

test('Numbers in the readmes match the code: step counts, limits, presets and the overflow counts of "abc"', () => {
  for (const doc of docs) {
    assert.ok(doc.includes('116') && doc.includes('230') && doc.includes('1,826'));
    assert.ok(doc.includes('65,536') && doc.includes('4,096'));
    assert.ok(doc.includes('44'));
    assert.ok(/\b35\b/.test(doc) && /\b62\b/.test(doc));
  }
  assert.equal(core.stepCount(1), 116);
  assert.equal(core.stepCount(2), 230);
  assert.equal(core.stepCount(16), 1826);
  assert.equal(presets.list.length, 44);
  assert.equal(new Set(presets.list.map(p => p.group)).size, 5);
  const app = read('app.js');
  assert.match(app, /const BYTE_LIMIT = 65536;/);
  assert.match(app, /const COLORED_LIMIT = 4096;/);
  const result = core.hash(Buffer.from('abc'));
  const trace = core.traceBlock(result, 0);
  assert.equal(trace.schedule.filter(s => s.dropped > 0).length, 35);
  assert.equal(trace.rounds.filter(r => r.T1.dropped > 0).length, 62);
  assert.equal(trace.final.filter(f => f.dropped > 0).length, 3);
  assert.equal(result.digestHex, crypto.createHash('sha256').update('abc').digest('hex'));
});

test('The fragment example in the readmes opens four bytes at round 51', () => {
  const input = require('../input-core.js');
  for (const doc of docs) assert.ok(doc.includes('#text=abc%0A&at=b1.r51&r=bin&l=ja'));
  const f = input.parseFragment('#text=abc%0A&at=b1.r51&r=bin&l=ja');
  assert.equal(f.text, 'abc\n');
  assert.equal(Buffer.byteLength(f.text), 4);
  assert.deepEqual(core.parsePositionId(f.at), { phase: 'round', block: 0, index: 51 });
});

test('Related tools, storage keys, unverified coverage and developer commands are documented', () => {
  for (const doc of docs) {
    for (const slug of ['hash-chain-tamper-trainer', 'hashviz', 'hex-dump-trainer', 'basexx-visualizer', 'weirdstring-inspector', 'hash-detector']) assert.ok(doc.includes('https://ipusiron.github.io/' + slug + '/'), slug);
    assert.ok(doc.includes('https://sha256algorithm.com/'));
    for (const key of ['sha256-byte-inspector.lang', 'sha256-byte-inspector.display']) assert.ok(doc.includes(key));
    assert.match(doc, /Safari/);
    assert.match(doc, /npm test/);
    assert.match(doc, /node --check/);
    assert.match(doc, /NOTICE\.md/);
  }
  for (const file of files().filter(f => /\.(?:md|js|json|html|yml|css)$/.test(f) && !f.startsWith('test/vectors/') && f !== 'test/readme.test.js')) {
    assert.doesNotMatch(read(file), /\b[CD]:[\\/](?!\\work)|\u6e1a|\u4ed5\u69d8\u66f8|\u8abf\u67fb\u5831\u544a|\u70b9\u691c\u8a18\u9332/, file);
  }
});
