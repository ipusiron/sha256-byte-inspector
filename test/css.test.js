/* Tests for style.css: reduced motion, no fixed width above 288px (the content
 * width at 320px), 44px interactive elements, the [hidden] override, the font
 * rules (no Segoe UI, no web fonts, the monospace stack with tabular numerals),
 * the fixed clock, the 2px focus ring, no glow effects, no role color used as a
 * fill, and the CSP rules app.js must follow (no style attribute, innerHTML or
 * insertRule). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const MONO = 'ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace';

/* The stylesheet without comments, and its declarations only (media query
 * preludes such as `@media (min-width: 768px)` removed). */
const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
const declarations = plain.replace(/@media[^{]*\{/g, '{');

/* The body of the first rule whose whole selector list is `selector`. */
function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp('(?:^|[{}])\\s*' + escaped + '\\s*\\{([^}]*)\\}').exec(plain);
  assert.ok(match, 'rule ' + selector);
  return match[1];
}

test('Reduced motion disables animation and transition, by media query and by the data-motion switch', () => {
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\*,\s*\*::before,\s*\*::after\s*\{[^}]*animation:\s*none\s*!important;[^}]*transition:\s*none\s*!important;/);
  assert.match(css, /:root\[data-motion="reduce"\] \*[^{]*\{[^}]*transition:\s*none\s*!important;/);
  assert.doesNotMatch(css, /transition:\s*all\b/);
  assert.doesNotMatch(css, /transition:[^;}]*\b(?:[4-9]\d\d|\d{4,})ms/, 'transitions are 300ms or shorter');
});

test('No fixed width above 288px in width, min-width, flex-basis, flex or grid columns', () => {
  const widths = [];
  for (const match of declarations.matchAll(/(?:^|[;{\s])(width|min-width|flex-basis|flex|grid-template-columns|inline-size|min-inline-size)\s*:\s*([^;}]+)/g)) {
    for (const px of match[2].matchAll(/(\d+(?:\.\d+)?)px/g)) widths.push([match[1], Number(px[1])]);
  }
  assert.ok(widths.length > 8, String(widths.length));
  for (const [property, value] of widths) assert.ok(value <= 288, property + ': ' + value + 'px');
  assert.doesNotMatch(declarations, /(?:^|[;{\s])height\s*:\s*\d{3,}px/, 'no tall fixed heights');
  assert.doesNotMatch(css, /\bvh\b|\d+vh\b/, 'use dvh, not vh');
});

test('Interactive elements have a 44px minimum size in one shared rule', () => {
  const body = rule('button, input, select, textarea, summary, a');
  assert.match(body, /min-height:\s*44px;/);
  assert.match(body, /min-width:\s*44px;/);
  assert.match(rule('input[type="checkbox"], input[type="radio"]'), /width:\s*44px;[^}]*height:\s*44px;/);
  assert.match(rule('.clock-row > button'), /flex:\s*0 0 44px;/);
  assert.match(rule('textarea'), /font-size:\s*1rem;/);
  assert.doesNotMatch(css, /outline:\s*none|outline:\s*0\b/);
});

test('[hidden] wins over every display rule', () => {
  assert.ok(css.replace(/\s/g, '').includes('[hidden]{display:none!important;}'));
  assert.match(css, /\.clock\.is-hidden\s*\{\s*display:\s*none;/);
});

test('Fonts: no Segoe UI, no web fonts or imports, the monospace stack with tabular slashed-zero numerals', () => {
  assert.doesNotMatch(css, /Segoe|@import|@font-face|url\(/);
  assert.ok(css.includes('--mono: ' + MONO + ';'));
  assert.match(css, /font-variant-numeric:\s*tabular-nums slashed-zero;/);
  assert.match(rule('body'), /font:\s*16px\/1\.6 system-ui/);
  assert.match(rule('body'), /min-height:\s*100dvh;/);
  for (const match of css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)(px|rem);/g)) {
    const px = match[2] === 'px' ? Number(match[1]) : Number(match[1]) * 16;
    assert.ok(px >= 14, 'font-size below 14px: ' + match[0]);
  }
});

test('The clock is fixed to the bottom of the viewport and the body leaves room for it', () => {
  const clock = rule('.clock');
  assert.match(clock, /position:\s*fixed;/);
  assert.match(clock, /inset-block-end:\s*0;/);
  assert.match(clock, /inset-inline:\s*0;/);
  assert.match(rule('body'), /padding:\s*16px 16px var\(--clock-height\);/);
  assert.match(css, /--clock-height:\s*\d+px;/);
});

test('Focus ring is 2px with a 2px offset in the focus token', () => {
  assert.match(rule(':focus-visible'), /outline:\s*2px solid var\(--focus\);[^}]*outline-offset:\s*2px;/);
});

test('Drafting look: no glow, role colors only on borders and text, theme blocks set color-scheme', () => {
  assert.doesNotMatch(css, /box-shadow|filter\s*:|text-shadow|backdrop-filter/);
  assert.doesNotMatch(declarations, /background(?:-color)?:\s*var\(--role[1-4]\)/, 'role colors are not fills');
  assert.doesNotMatch(declarations, /background(?:-color)?:\s*var\(--(?:warn|muted|line|bit0|border)\)/);
  assert.match(rule(':root'), /color-scheme:\s*dark;/);
  assert.match(rule(':root[data-theme="light"]'), /color-scheme:\s*light;/);
  assert.doesNotMatch(plain, /prefers-color-scheme/, 'app.js decides the theme and sets data-theme');
  const outsideTokens = declarations.replace(/--[\w-]+:\s*#[0-9a-f]{6};/g, '');
  assert.doesNotMatch(outsideTokens, /#[0-9a-fA-F]{3,8}\b/, 'colors come from the tokens');
});

test('Breakpoints: one column, a 64px entrance rail from 768px to 1279px, stage plus 280px dock from 1280px', () => {
  assert.match(css, /@media \(min-width: 768px\) and \(max-width: 1279px\)\s*\{[\s\S]*?main\s*\{[^}]*grid-template-columns:\s*64px minmax\(0, 1fr\);/);
  assert.match(css, /@media \(min-width: 1280px\)\s*\{[\s\S]*?\.free-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 280px;/);
  assert.match(rule('.bits'), /grid-template-columns:\s*repeat\(16, var\(--bit-cell\)\);/);
  assert.match(css, /@media \(min-width: 768px\)\s*\{[\s\S]*?\.bits\s*\{[^}]*repeat\(32, var\(--bit-cell\)\);/);
  assert.match(rule('.byte-cells'), /grid-template-columns:\s*repeat\(8, var\(--byte-cell\)\);/);
  assert.match(css, /@media \(min-width: 640px\)\s*\{[\s\S]*?\.byte-cells\s*\{[^}]*repeat\(16, var\(--byte-cell\)\);/);
  for (const [query, cell] of [['', 16], ['390', 18], ['768', 19], ['1280', 20]]) {
    const pattern = query ? new RegExp('@media \\(min-width: ' + query + 'px\\)\\s*\\{\\s*:root\\s*\\{[^}]*--bit-cell:\\s*' + cell + 'px;') : /--bit-cell:\s*16px;/;
    assert.match(css, pattern, 'bit cell ' + cell + 'px');
  }
  assert.match(rule('.stage-rail'), /overflow-x:\s*auto;/);
});

test('app.js uses no style attribute, innerHTML or insertRule', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.doesNotMatch(app, /setAttribute\(\s*['"]style['"]/);
  assert.doesNotMatch(app, /innerHTML/);
  assert.doesNotMatch(app, /insertRule|createElement\(\s*['"]style['"]\)/);
  assert.doesNotMatch(app, /\.style\.cssText|\.style\s*=\s*['"`]/);
});
