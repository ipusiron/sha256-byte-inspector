/* Tests for theme-init.js: it runs in a stand-in window with a given saved value and
 * OS setting, and the data-theme it sets on <html> is checked. Without a saved
 * choice the page opens dark (blueprint) whatever the OS setting is; a saved light
 * or dark wins; any other value, broken JSON or unavailable storage falls back to
 * dark. index.html loads it in <head> after style.css, without defer. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const source = read('theme-init.js');

function run({ saved = null, prefersDark = false, storageThrows = false } = {}) {
  const dataset = {};
  const window = {
    localStorage: {
      getItem(key) {
        if (storageThrows) throw new Error('blocked');
        assert.equal(key, 'sha256-byte-inspector.display');
        return saved;
      }
    },
    matchMedia: () => ({ matches: prefersDark }),
    document: { documentElement: { dataset } }
  };
  vm.runInNewContext(source, { window });
  return dataset.theme;
}

test('Without a saved choice the page opens dark whatever the OS setting is', () => {
  assert.equal(run({ prefersDark: true }), 'dark');
  assert.equal(run({ prefersDark: false }), 'dark');
});

test('A saved choice wins over the OS setting', () => {
  assert.equal(run({ saved: '{"theme":"light"}', prefersDark: true }), 'light');
  assert.equal(run({ saved: '{"theme":"dark"}', prefersDark: false }), 'dark');
});

test('Unexpected or broken saved values are ignored and the page opens dark', () => {
  for (const saved of ['{"theme":"blue"}', '"light"', 'light', '{', 'null', '[]']) {
    assert.equal(run({ saved, prefersDark: false }), 'dark', saved);
  }
});

test('Unavailable storage does not throw and the page opens dark', () => {
  assert.equal(run({ storageThrows: true, prefersDark: false }), 'dark');
});

test('index.html loads theme-init.js in <head> after style.css, without defer', () => {
  const html = read('index.html');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(head.includes('<script src="theme-init.js"></script>'), 'theme-init.js is in <head> without defer, async or type');
  assert.ok(head.indexOf('style.css') < head.indexOf('theme-init.js'));
  assert.ok(head.indexOf('theme-init.js') < head.indexOf('app.js'));
});
