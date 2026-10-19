/* Tests for style.css: reduced motion by the OS setting only, no fixed width
 * above 288px (the content width at 320px), one column at every width with a
 * 1040px centered column from 1280px, 44px interactive elements, the [hidden]
 * override, the font rules (no Segoe UI, no web fonts, the monospace stack with
 * tabular numerals), the digest band's sizes and columns, the fixed clock, the
 * 2px focus ring, no glow effects, no role color used as a fill, and the CSP
 * rules app.js must follow (no style attribute, innerHTML or insertRule). */
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

/* The stylesheet without the blocks that apply from 768px up (a fixed width
 * there cannot overflow a 320px screen). Braces are matched, not guessed. */
function withoutWideMedia(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const at = source.indexOf('@media', i);
    if (at < 0) {
      out += source.slice(i);
      break;
    }
    const open = source.indexOf('{', at);
    let depth = 1;
    let j = open + 1;
    while (j < source.length && depth > 0) {
      if (source[j] === '{') depth += 1;
      else if (source[j] === '}') depth -= 1;
      j += 1;
    }
    const min = /min-width:\s*(\d+)px/.exec(source.slice(at, open));
    out += source.slice(i, at);
    if (!(min && Number(min[1]) >= 768)) out += source.slice(at, j);
    i = j;
  }
  return out;
}
const narrow = withoutWideMedia(plain).replace(/@media[^{]*\{/g, '{');

/* The body of a media block whose prelude is exactly `query`. */
function media(query) {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp('@media ' + escaped + '\\s*\\{([\\s\\S]*?)\\n\\}').exec(plain);
  assert.ok(match, 'media ' + query);
  return match[1];
}

/* The body of the first rule whose whole selector list is `selector`, in `source`. */
function ruleIn(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp('(?:^|[{}])\\s*' + escaped + '\\s*\\{([^}]*)\\}').exec(source);
  assert.ok(match, 'rule ' + selector);
  return match[1];
}
const rule = selector => ruleIn(plain, selector);

test('Reduced motion follows the OS setting only: the media query disables animation and transition, there is no data-motion switch', () => {
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\*,\s*\*::before,\s*\*::after\s*\{[^}]*animation:\s*none\s*!important;[^}]*transition:\s*none\s*!important;/);
  assert.doesNotMatch(css, /data-motion/);
  assert.doesNotMatch(css, /transition:\s*all\b/);
  assert.doesNotMatch(css, /transition:[^;}]*\b(?:[4-9]\d\d|\d{4,})ms/, 'transitions are 300ms or shorter');
});

test('No fixed width above 288px in width, min-width, flex-basis, flex or grid columns below 768px; 1040px is the only wide max-width of the column', () => {
  const widths = [];
  for (const match of narrow.matchAll(/(?:^|[;{\s])(width|min-width|flex-basis|flex|grid-template-columns|inline-size|min-inline-size)\s*:\s*([^;}]+)/g)) {
    for (const px of match[2].matchAll(/(\d+(?:\.\d+)?)px/g)) widths.push([match[1], Number(px[1])]);
  }
  assert.ok(widths.length > 8, String(widths.length));
  for (const [property, value] of widths) assert.ok(value <= 288, property + ': ' + value + 'px');
  assert.ok(narrow.includes('--byte-cell: 32px'));
  assert.doesNotMatch(css, /300px|64px minmax/, 'the dock column and the entrance rail are gone');
  const tracks = [...declarations.matchAll(/grid-template-columns\s*:\s*([^;}]+)/g)].flatMap(match => [...match[1].matchAll(/(\d+)px/g)].map(px => Number(px[1])));
  assert.deepEqual(tracks.filter(value => value > 288), [], 'no wide fixed grid track at any width');
  const maxWidths = [...declarations.matchAll(/max-width\s*:\s*(\d+)px/g)].map(match => Number(match[1])).sort((a, b) => a - b);
  assert.deepEqual(maxWidths, [280, 640, 1040, 1288, 1320], 'the clock heading cell (280px), the help dialog (640px), the column (1040px), the clock inner (1288px) and the body (1320px)');
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
  /* The placeholder of the compare field is drawn in the muted token (8.97:1 and
   * 6.42:1 on --bg); the browser default is a mid grey below 4.5:1 on both themes. */
  assert.match(rule('::placeholder'), /color:\s*var\(--muted\);[^}]*opacity:\s*1;/);
});

test('Round icon buttons: 44px circles with a 22px currentColor icon, right-aligned in the header tools row', () => {
  const button = rule('.icon-button');
  assert.match(button, /width:\s*44px;[^}]*height:\s*44px;/);
  assert.match(button, /padding:\s*0;/);
  assert.match(button, /border:\s*1px solid var\(--border\);/);
  assert.match(button, /border-radius:\s*50%;/);
  assert.match(button, /background:\s*var\(--surface\);/);
  assert.match(button, /color:\s*var\(--fg\);/);
  assert.match(rule('.icon-button svg'), /width:\s*22px;[^}]*height:\s*22px;/);
  assert.match(rule('.icon-button:hover, .icon-button:focus-visible'), /border-color:\s*var\(--role1\);/);
  const tools = rule('.header-tools');
  assert.match(tools, /display:\s*flex;/);
  assert.match(tools, /justify-content:\s*flex-end;/);
  assert.match(tools, /gap:\s*8px;/);
  assert.match(rule('.page-header'), /display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
  const wide = media('(min-width: 768px)');
  assert.match(ruleIn(wide, '.page-header'), /grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\);/, 'the title stays centered from 768px');
  assert.match(ruleIn(wide, '.header-tools'), /grid-column:\s*3;/);
  assert.doesNotMatch(css, /header-controls|theme-select/);
});

test('One column at every width: main is a one-column grid with a 16px gap, 1040px wide and centered from 1280px; no entrance, tab, dock or panel rules remain', () => {
  const column = rule('main');
  assert.match(column, /display:\s*grid;/);
  assert.match(column, /grid-template-columns:\s*minmax\(0, 1fr\);/);
  assert.match(column, /gap:\s*16px;/);
  assert.match(column, /align-items:\s*start;/);
  const wide = media('(min-width: 1280px)');
  assert.match(ruleIn(wide, '.page-header, main, footer'), /max-width:\s*1040px;[^}]*margin-inline:\s*auto;/, 'the header, the column and the footer share the 1040px width');
  assert.equal((wide.match(/max-width:\s*1040px;/g) || []).length, 1, 'one shared rule, so the edges cannot drift apart');
  assert.doesNotMatch(css, /\.entries|role="tab|\.free-|\.dock|#dock|\.learn-|position:\s*sticky|writing-mode|aside/);
  assert.doesNotMatch(css, /@media \(min-width: 768px\) and \(max-width: 1279px\)/, 'no entrance rail between 768px and 1279px');
  assert.match(rule('.card'), /padding:\s*8px 6px;[^}]*border:\s*1px solid var\(--line\);[^}]*background:\s*var\(--surface\);/);
  const title = rule('.section-title');
  assert.match(title, /display:\s*flex;[^}]*align-items:\s*center;[^}]*gap:\s*8px;/);
  assert.match(title, /font-size:\s*1\.25rem;/);
  const number = rule('.section-number');
  assert.match(number, /border:\s*1px solid var\(--role1\);[^}]*color:\s*var\(--role1\);/);
  assert.match(number, /font:\s*700 1rem\/1 var\(--mono\);/);
});

test('Boards: no side frame below 390px (the 16-cell band needs 271px of the 274px content box at 320px), framed from 390px', () => {
  const board = rule('.board');
  assert.match(board, /padding:\s*8px 0 0;/);
  assert.match(board, /border-block-start:\s*1px solid var\(--line\);/);
  assert.doesNotMatch(board, /(?:^|[;\s])border:|padding-inline/);
  const from390 = media('(min-width: 390px)');
  assert.match(ruleIn(from390, '.card, .board'), /padding:\s*12px;/);
  assert.match(ruleIn(from390, '.board'), /border:\s*1px solid var\(--line\);/);
  assert.match(ruleIn(media('(min-width: 768px)'), '.card, .board'), /padding:\s*16px;/);
  const tight = media('(min-width: 768px) and (max-width: 800px)');
  assert.match(tight, /--bit-gap:\s*0;/);
  assert.match(ruleIn(tight, '.board'), /padding-inline:\s*8px;/);
  /* From 768px a stacked addition is as wide as a one-letter lane (label 1ch, tile
   * 8ch + 14px, 8px gap, 32 cells + 31 gaps), so its values end where those bands end. */
  assert.match(ruleIn(media('(min-width: 768px)'), '.sum'), /max-width:\s*calc\(32 \* var\(--bit-cell\) \+ 9ch \+ 53px\);/);
  assert.match(rule('.sum-row'), /justify-content:\s*space-between;/);
});

test('Digest band: 2px frame on the page background, 8-digit groups in 2 columns at 1.375rem, 4 columns at 1.5rem from 768px and 8 columns at 1.375rem from 1280px', () => {
  const groups = rule('.digest-groups');
  assert.match(groups, /display:\s*grid;/);
  assert.match(groups, /grid-template-columns:\s*repeat\(2, max-content\);/);
  assert.match(groups, /border:\s*2px solid var\(--line\);/);
  assert.match(groups, /background:\s*var\(--bg\);/, 'the band is a well like the input fields');
  assert.match(groups, /color:\s*var\(--fg\);/);
  assert.match(groups, /font-size:\s*1\.375rem;/);
  assert.match(ruleIn(media('(min-width: 768px)'), '.digest-groups'), /grid-template-columns:\s*repeat\(4, max-content\);[^}]*font-size:\s*1\.5rem;/);
  assert.match(ruleIn(media('(min-width: 1280px)'), '.digest-groups'), /grid-template-columns:\s*repeat\(8, max-content\);[^}]*font-size:\s*1\.375rem;/);
  assert.match(css, /\.digest-groups:empty\s*\{\s*display:\s*none;/);
  assert.match(rule('.digest-groups span'), /white-space:\s*nowrap;/);
  assert.match(rule('.digest-groups[data-radix="bin"]'), /grid-template-columns:\s*minmax\(0, 1fr\);/);
  assert.match(ruleIn(media('(min-width: 1280px)'), '.digest-groups[data-radix="bin"]'), /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/, 'binary: two words per row, four rows, from 1280px');
  assert.match(/^[^{]*\{/.exec(plain.slice(plain.indexOf('.digest-groups, .sum')))[0], /\.digest-groups/, 'digest groups use the monospace stack');
  const head = rule('.result-head');
  assert.match(head, /display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*justify-content:\s*flex-end;/);
  assert.match(rule('.result-head > h2'), /margin-inline-end:\s*auto;/, 'the heading pushes the badge to the right end');
  assert.doesNotMatch(css, /\.result-body/);
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

test('The clock is fixed to the bottom on the surface color under a role-1 rule, with its heading cell, and the body leaves room for it through --clock-height', () => {
  const clock = rule('.clock');
  assert.match(clock, /position:\s*fixed;/);
  assert.match(clock, /inset-block-end:\s*0;/);
  assert.match(clock, /inset-inline:\s*0;/);
  assert.match(clock, /border-block-start:\s*1px solid var\(--role1\);/, 'a thin role-1 rule on top, no glow');
  assert.match(clock, /background:\s*var\(--surface\);/, 'the bar stands apart from the page background');
  const head = rule('.clock-head');
  assert.match(head, /display:\s*flex;[^}]*flex-wrap:\s*wrap;/);
  assert.match(head, /font-size:\s*14px;/);
  assert.match(rule('.clock-title'), /font-weight:\s*700;/);
  assert.match(rule('#clock-range'), /flex:\s*1 1 120px;[^}]*min-width:\s*100px;/);
  const wide = media('(min-width: 768px)');
  assert.match(ruleIn(wide, '.clock-inner'), /grid-template-columns:\s*auto minmax\(120px, 1fr\) auto;/, 'one row from 768px: heading, slider, buttons');
  assert.match(ruleIn(wide, '.clock-head'), /max-width:\s*280px;/);
  assert.match(rule('body'), /padding:\s*16px 16px var\(--clock-height\);/);
  assert.match(rule(':root'), /--clock-height:\s*\d+px;/);
  assert.doesNotMatch(css, /--dock-offset|--rail-width/);
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

test('Breakpoints: 16- and 32-cell bands, 8- and 16-byte rows, the bit cell sizes and the scrolling rail', () => {
  assert.match(rule('.bits'), /grid-template-columns:\s*repeat\(16, var\(--bit-cell\)\);/);
  assert.match(ruleIn(media('(min-width: 768px)'), '.bits'), /repeat\(32, var\(--bit-cell\)\);/);
  assert.match(rule('.byte-cells'), /grid-template-columns:\s*repeat\(8, var\(--byte-cell\)\);/);
  assert.match(ruleIn(media('(min-width: 640px)'), '.byte-cells'), /repeat\(16, var\(--byte-cell\)\);/);
  for (const [query, cell] of [['', 16], ['390', 18], ['768', 19], ['1280', 20]]) {
    const pattern = query ? new RegExp('@media \\(min-width: ' + query + 'px\\)\\s*\\{\\s*:root\\s*\\{[^}]*--bit-cell:\\s*' + cell + 'px;') : /--bit-cell:\s*16px;/;
    assert.match(css, pattern, 'bit cell ' + cell + 'px');
  }
  assert.match(rule('.stage-rail'), /overflow-x:\s*auto;/);
});

test('Computation panels: the active panel frame, word rows without side padding, role-colored reference rows and message-block bit kinds', () => {
  assert.match(rule('.board.is-active'), /border-color:\s*var\(--role1\);/);
  const row = rule('.w-row');
  assert.match(row, /display:\s*flex;[^}]*flex-wrap:\s*wrap;/);
  assert.match(row, /padding:\s*2px 0;/, 'the 16-cell band fills the 274px content box at 320px');
  assert.match(row, /border:\s*1px solid transparent;/);
  assert.match(rule('.w-row.is-current'), /border-color:\s*var\(--role1\);[^}]*outline:\s*1px solid var\(--role1\);/);
  assert.match(rule('.w-rows.is-current'), /outline:\s*1px solid var\(--role1\);/);
  assert.match(rule('.w-row[data-ref="16"], .w-row[data-ref="7"]'), /border-color:\s*var\(--role2\);/, 'words added as they are');
  assert.match(rule('.w-row[data-ref="15"], .w-row[data-ref="2"]'), /border-color:\s*var\(--role3\);/, 'words fed to sigma');
  assert.match(rule('.w-index'), /color:\s*var\(--role1\);[^}]*font:\s*14px\/1\.5 var\(--mono\);/);
  assert.match(rule('.bit.k-message'), /border-color:\s*var\(--role1\);/);
  assert.match(rule('.bit.k-one'), /border-color:\s*var\(--role2\);/);
  assert.match(rule('.bit.k-zeros'), /border-style:\s*dotted;/);
  assert.match(rule('.bit.k-length'), /border-color:\s*var\(--role3\);/);
  assert.match(rule('.insert'), /border-block:\s*1px solid var\(--role1\);/, 'narrow boards tie the bands to the row with rules above and below');
  assert.match(ruleIn(media('(min-width: 768px)'), '.insert'), /border-inline-start:\s*2px solid var\(--role1\);/);
  assert.doesNotMatch(css, /\.board\[hidden\]|#board-pad|#board-split/);
});

test('Round table: row buttons that wrap their values into 10ch columns below 768px and stand in nine columns with the heading row from 768px', () => {
  const row = rule('.rt-row');
  assert.match(row, /display:\s*grid;/);
  assert.match(row, /grid-template-columns:\s*repeat\(auto-fill, minmax\(10ch, 1fr\)\);/);
  assert.match(row, /width:\s*100%;/);
  assert.match(row, /background:\s*transparent;/);
  assert.match(row, /font:\s*14px\/1\.5 var\(--mono\);/);
  assert.match(row, /text-align:\s*start;/);
  assert.match(rule('.rt-row.is-current'), /border-color:\s*var\(--role1\);[^}]*outline:\s*1px solid var\(--role1\);/);
  assert.match(rule('.rt-head'), /display:\s*none;/);
  const wide = media('(min-width: 768px)');
  assert.match(ruleIn(wide, '.rt-head'), /display:\s*grid;[^}]*grid-template-columns:\s*3ch repeat\(8, minmax\(8ch, 1fr\)\);/);
  assert.match(ruleIn(wide, '.rt-row'), /grid-template-columns:\s*3ch repeat\(8, minmax\(8ch, 1fr\)\);/);
  assert.match(ruleIn(wide, '.rt-key'), /clip-path:\s*inset\(50%\);/, 'the register letters are read by AT only once the heading row shows');
  assert.match(rule('.rt-cell'), /white-space:\s*nowrap;/);
});

test('Help dialog: surface, 1px rule, 640px at most, scrolls vertically, no padding on the element, backdrop from the page background', () => {
  const dialog = rule('.help-dialog');
  assert.match(dialog, /max-width:\s*640px;/);
  assert.match(dialog, /width:\s*calc\(100% - 32px\);/);
  assert.match(dialog, /padding:\s*0;/);
  assert.match(dialog, /border:\s*1px solid var\(--line\);/);
  assert.match(dialog, /background:\s*var\(--surface\);/);
  assert.match(dialog, /color:\s*var\(--fg\);/);
  assert.match(dialog, /overflow:\s*auto;/);
  assert.match(dialog, /max-height:\s*calc\(100dvh - 32px\);/);
  assert.match(rule('.help-dialog::backdrop'), /background:\s*var\(--bg\);[^}]*opacity:\s*0\.7;/);
  assert.match(rule('.help-head'), /display:\s*flex;[^}]*justify-content:\s*space-between;/);
  assert.match(rule('.help-keys'), /grid-template-columns:\s*max-content minmax\(0, 1fr\);/);
  assert.match(rule('kbd'), /border:\s*1px solid var\(--border\);[^}]*font-family:\s*var\(--mono\);/);
});

test('Copy row and legend: the copy heading with tighter gaps, the legend rule and caption, faded labels of disabled settings', () => {
  assert.match(rule('.result-actions'), /gap:\s*8px 12px;/);
  assert.match(rule('.result-actions button'), /padding-inline:\s*0\.5rem;/);
  assert.match(rule('.actions-label'), /font-weight:\s*600;/);
  assert.match(rule('.byte-legend'), /border-block-start:\s*1px solid var\(--line\);/);
  assert.match(rule('.legend-caption'), /color:\s*var\(--muted\);/);
  assert.match(rule('#input-options[data-off] label'), /color:\s*var\(--muted\);/);
});

test('Motion: no keyframes, the step moves classes only; transitions stay on transform and opacity', () => {
  assert.doesNotMatch(css, /@keyframes/);
  assert.match(rule('.bit, .tile, .lane'), /transition:\s*transform 300ms, opacity 300ms;/);
  assert.doesNotMatch(css, /transition:[^;}]*(?:border|outline|color|background)/, 'emphasis switches at once');
  assert.doesNotMatch(css, /scroll-behavior:\s*smooth/);
});

test('app.js uses no style attribute, innerHTML or insertRule', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.doesNotMatch(app, /setAttribute\(\s*['"]style['"]/);
  assert.doesNotMatch(app, /innerHTML/);
  assert.doesNotMatch(app, /insertRule|createElement\(\s*['"]style['"]\)/);
  assert.doesNotMatch(app, /\.style\.cssText|\.style\s*=\s*['"`]/);
});
