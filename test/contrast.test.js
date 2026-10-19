/* Contrast of the color tokens in style.css for both themes. The dark palette is
 * the plain `:root` block and the light palette is `:root[data-theme="light"]`.
 * Every pair of the token table in CLAUDE.md is checked against its threshold
 * (4.5:1 for text, 3:1 for borders and focus) with the WCAG 2.x formula, and the
 * ratio is pinned to two decimals so a changed token shows up immediately. The
 * expected numbers were computed with Node from the token values. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');

const TOKENS = ['bg', 'surface', 'fg', 'muted', 'line', 'bit0', 'border', 'role1', 'role2', 'role3', 'role4', 'diff', 'warn', 'focus'];
const blocks = [...css.matchAll(/(:root(?:\[data-theme="light"\])?)\s*\{([^}]*)\}/g)].filter(([, , body]) => body.includes('--bg:'));
const palettes = {};
for (const [, selector, body] of blocks) {
  const name = selector === ':root' ? 'dark' : 'light';
  assert.equal(palettes[name], undefined, 'one palette per theme');
  palettes[name] = Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/g)].map(([, token, color]) => [token, color]));
}

/* [foreground, background, threshold, dark ratio, light ratio] */
const PAIRS = [
  ['fg', 'bg', 4.5, 16.19, 14.84],
  ['fg', 'surface', 4.5, 14.50, 13.80],
  ['muted', 'bg', 4.5, 8.97, 6.42],
  ['muted', 'surface', 4.5, 8.03, 5.97],
  ['bit0', 'bg', 4.5, 5.44, 5.28],
  ['bit0', 'surface', 4.5, 4.87, 4.91],
  ['role1', 'bg', 4.5, 10.00, 5.31],
  ['role2', 'bg', 4.5, 10.57, 5.85],
  ['role3', 'bg', 4.5, 9.16, 6.72],
  ['role4', 'bg', 4.5, 10.33, 4.93],
  ['role1', 'surface', 3, 8.96, 4.94],
  ['role2', 'surface', 3, 9.47, 5.44],
  ['role3', 'surface', 3, 8.20, 6.25],
  ['role4', 'surface', 3, 9.25, 4.58],
  ['bg', 'diff', 4.5, 7.38, 5.60],
  ['diff', 'bg', 3, 7.38, 5.60],
  ['diff', 'surface', 3, 6.61, 5.20],
  ['warn', 'bg', 4.5, 10.57, 5.85],
  ['warn', 'surface', 4.5, 9.47, 5.44],
  ['focus', 'bg', 3, 18.92, 19.24],
  ['focus', 'surface', 3, 16.95, 17.89],
  ['border', 'bg', 3, 5.44, 5.28],
  ['border', 'surface', 3, 4.87, 4.91]
];

function luminance(color) {
  assert.match(color, /^#[0-9a-f]{6}$/);
  const channels = color.slice(1).match(/../g).map(hex => parseInt(hex, 16) / 255)
    .map(value => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return channels.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}

function ratio(front, back) {
  const values = [luminance(front), luminance(back)].sort((a, b) => a - b);
  return (values[1] + 0.05) / (values[0] + 0.05);
}

test('Both themes define the same fourteen color tokens with the contract values', () => {
  assert.deepEqual(Object.keys(palettes).sort(), ['dark', 'light']);
  for (const name of ['dark', 'light']) assert.deepEqual(Object.keys(palettes[name]).sort(), TOKENS.slice().sort(), name);
  assert.equal(palettes.dark.bg, '#0d1117');
  assert.equal(palettes.light.bg, '#f6f5f0');
  assert.equal(palettes.dark.fg, '#e8eef4');
  assert.equal(palettes.light.fg, '#1b2129');
  assert.equal(palettes.dark.focus, '#ffffff');
  assert.equal(palettes.light.focus, '#000000');
  for (const name of ['dark', 'light']) {
    assert.equal(palettes[name].warn, palettes[name].role2, name + ': warn equals role2');
    assert.equal(palettes[name].border, palettes[name].bit0, name + ': the control border reuses the bit-0 grey');
    assert.notEqual(palettes[name].bg, palettes[name].surface, name);
    const roles = [1, 2, 3, 4].map(n => palettes[name]['role' + n]);
    assert.equal(new Set(roles).size, 4, name + ': role colors are distinct');
    assert.ok(!roles.includes(palettes[name].diff), name + ': diff is not a role color');
  }
  assert.ok(luminance(palettes.dark.bg) < luminance(palettes.dark.fg), 'dark theme is light on dark');
  assert.ok(luminance(palettes.light.bg) > luminance(palettes.light.fg), 'light theme is dark on light');
});

for (const [mode, index] of [['dark', 3], ['light', 4]]) {
  for (const pair of PAIRS) {
    const [front, back, threshold] = pair;
    test(`Contrast: ${mode} ${front}/${back} meets ${threshold}:1`, () => {
      const value = ratio(palettes[mode][front], palettes[mode][back]);
      assert.ok(value >= threshold, String(value));
      assert.equal(Number(value.toFixed(2)), pair[index]);
    });
  }
}

test('The clock bar and the help dialog sit on --surface: their text (fg, muted) reads at 4.5:1 and the role-1 rule at 3:1 in both themes', () => {
  assert.match(css, /\.clock\s*\{[^}]*border-block-start:\s*1px solid var\(--role1\);[^}]*background:\s*var\(--surface\);/);
  assert.match(css, /\.help-dialog\s*\{[^}]*background:\s*var\(--surface\);[^}]*color:\s*var\(--fg\);/);
  for (const name of ['dark', 'light']) {
    const p = palettes[name];
    assert.ok(ratio(p.fg, p.surface) >= 4.5, name + ' fg/surface ' + ratio(p.fg, p.surface));
    assert.ok(ratio(p.muted, p.surface) >= 4.5, name + ' muted/surface ' + ratio(p.muted, p.surface));
    assert.ok(ratio(p.role1, p.surface) >= 3, name + ' role1/surface ' + ratio(p.role1, p.surface));
    /* Buttons inside the clock keep their --border edge against the same surface. */
    assert.ok(ratio(p.border, p.surface) >= 3, name + ' border/surface ' + ratio(p.border, p.surface));
    /* The backdrop is --bg at 70% over the page; the dialog itself is opaque, so its text contrast is the surface pair above. */
    assert.ok(ratio(p.bg, p.surface) < 1.5, name + ' bg/surface stays a faint step ' + ratio(p.bg, p.surface));
  }
});

test('Decorative rules stay faint and do not compete with the numbers', () => {
  for (const name of ['dark', 'light']) {
    const line = ratio(palettes[name].line, palettes[name].bg);
    assert.ok(line >= 1.3 && line <= 1.7, name + ' line/bg ' + line);
  }
});
