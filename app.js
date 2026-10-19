/* SHA-256 Byte Inspector - MIT (c) 2026 ipusiron
 * app.js wires the page to the pure modules: SHA256ByteInput (text and hex input),
 * SHA256ByteCore (hash and trace), SHA256ByteView (rendering models), SHA256BytePresets
 * and SHA256ByteMessages (wording). The state object is the single source of truth;
 * every render builds elements with createElement and textContent and never writes
 * markup or inline styles; the only CSSOM write is the custom property --clock-height
 * on <html>, the measured height of the fixed clock that the body's bottom padding
 * reads. The page is one column read top-down in five sections: input, input
 * settings, the bytes after UTF-8 encoding, the SHA-256 computation and the output
 * (digest, radix, copy buttons, comparison). The computation section lays the whole
 * computation of the current block out at once (message block, the 64 schedule words,
 * the round with its 64-row table, the final addition, the digest); it is built once
 * per block, language and radix, and every step of the clock only moves the emphasis
 * classes, refills the register bands and the inserted bands of the current step and
 * scrolls the current row into view. The clock plays automatically with a setTimeout
 * chain whose interval follows the speed select. The help button opens a <dialog>
 * built from the help.* keys. localStorage holds only the language and the theme;
 * reduced motion follows the OS setting through CSS. The URL fragment is read once at
 * start-up and then cleared from the address bar (the only write to the URL). */
(function () {
  'use strict';

  const core = window.SHA256ByteCore;
  const input = window.SHA256ByteInput;
  const presets = window.SHA256BytePresets;
  const view = window.SHA256ByteView;
  const messages = window.SHA256ByteMessages;
  const $ = id => document.getElementById(id);

  /* The five panels of the computation section in document order, and the panel each
   * phase of the step model lives in (padding and split share the message block). */
  const PANELS = ['block', 'schedule', 'round', 'final', 'digest'];
  const PANEL_OF = Object.freeze({ pad: 'block', split: 'block', schedule: 'schedule', round: 'round', final: 'final', digest: 'digest' });
  /* The stage rail: one button per phase; the digit keys 1 to 6 follow the same order. */
  const RAIL = ['pad', 'split', 'schedule', 'round', 'final', 'digest'];
  const RADIXES = ['hex', 'bin', 'dec'];
  const GRANULARITIES = ['step', 'eight', 'phase', 'block'];
  /* Copy buttons of the output section that need only a result; copy-worksheet also
   * needs the round to be the current phase. */
  const COPY_IDS = ['copy-hash', 'copy-bytes-spaced', 'copy-bytes-joined', 'copy-sha256sum'];
  const LANG_KEY = 'sha256-byte-inspector.lang';
  const DISPLAY_KEY = 'sha256-byte-inspector.display';
  const BYTE_LIMIT = 65536;
  const FRAGMENT_LIMIT = 10000;
  const COLORED_LIMIT = 4096;
  const PER_ROW = 16;
  /* Bytes shown at each end of a long message segment of the padding strip. */
  const PAD_EDGE_BYTES = 16;
  /* Characters shown on each side of the offending character of a hex error. */
  const ERROR_CONTEXT = 16;
  const ELLIPSIS = String.fromCharCode(0x2026);
  /* Milliseconds before the clock returns after a text area loses focus (see wireStage). */
  const CLOCK_RETURN_DELAY = 300;
  /* Pixels added to the clock's measured height for --clock-height. */
  const CLOCK_MARGIN = 8;
  /* Autoplay: milliseconds per step at 1x; the speed select divides it (0.25x to 8x). */
  const PLAY_INTERVAL = 1000;
  /* Milliseconds after a wheel, touch or scrollbar scroll by the user during which the
   * clock does not scroll the page to the current row. */
  const FOLLOW_PAUSE = 1000;
  /* Window after the page's own scroll during which scroll events are not the user's. */
  const OWN_SCROLL_WINDOW = 120;
  /* Milliseconds of quiet typing before the computation section is redrawn. */
  const COMPUTE_DELAY = 300;
  const PLAY_GLYPH = '\u25b6';
  const PAUSE_GLYPH = '\u2016';
  /* Keyboard help: the key names (shown in <kbd>), the dictionary key, the separator. */
  const HELP_KEYS = [
    [['\u2190', '\u2192'], 'help.keys.arrows', ' '],
    [['Shift+\u2190', 'Shift+\u2192'], 'help.keys.shiftArrows', ' '],
    [['PageUp', 'PageDown'], 'help.keys.page', ' '],
    [['Home', 'End'], 'help.keys.homeEnd', ' '],
    [['1', '6'], 'help.keys.digits', ' \u2013 '],
    [['Space'], 'help.keys.space', ' '],
    [['?'], 'help.keys.help', ' ']
  ];
  const DEFAULT_OPTIONS = Object.freeze({ newline: 'lf', trailingNewline: false, bom: false });
  const encoder = new TextEncoder();

  const state = {
    mode: 'text',
    text: '',
    hexText: '',
    options: Object.assign({}, DEFAULT_OPTIONS),
    bytes: null,
    chars: null,
    stats: null,
    warnings: [],
    inputError: null,
    result: null,
    traces: [],
    position: { phase: 'pad', block: 0, index: 0 },
    radix: 'hex',
    compare: '',
    presetId: null,
    busy: false,
    cryptoStatus: 'unknown',
    request: 0,
    granularity: 'step',
    theme: 'dark',
    error: null
  };
  let language = 'en';
  let day117Cache = null;
  let layoutFrame = 0;
  /* The built computation section (see buildCompute) and the autoplay state. */
  let computeView = null;
  let playing = false;
  let playTimer = 0;
  let userScrollAt = -Infinity;
  let ownScrollUntil = 0;
  /* Typing updates the input, bytes and output at once; the computation section waits
   * until the keys have been still for COMPUTE_DELAY ms (see updateCompute). */
  let deferCompute = false;
  let computeTimer = 0;
  /* Layout facts measured once per resize instead of on every step. */
  let railOverflows = true;
  let clockHeightCache = 0;
  /* Autoplay keeps at least this share of the time free for the browser (pointer,
   * scrolling, painting): the next step waits until a step's cost times this factor. */
  const PLAY_IDLE_FACTOR = 3;

  /* ---- wording and small helpers ---- */

  function t(key, values) {
    const text = messages[language][key];
    if (text === undefined) throw new Error('Missing translation: ' + key);
    if (!values) return text;
    return text.replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(values, name) ? String(values[name]) : match));
  }

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined && text !== null) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function formatNumber(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      /* Storage is optional. */
    }
  }

  function matches(query) {
    return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  }

  function setBusy(busy) {
    state.busy = busy;
    document.body.setAttribute('aria-busy', String(busy));
  }

  /* Runs an action (sync or async) and turns a thrown error into the error line. */
  async function perform(action) {
    if (state.busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      state.error = 'generic';
      renderError();
    } finally {
      setBusy(false);
    }
  }

  /* ---- language and theme ---- */

  function pickLanguage(candidates) {
    const found = candidates.find(value => value === 'ja' || value === 'en');
    if (found) return found;
    return typeof navigator.language === 'string' && navigator.language.startsWith('ja') ? 'ja' : 'en';
  }

  /* The saved display settings hold the theme only; without one the page opens in
   * the blueprint (dark) theme whatever the OS setting is. Reduced motion is not stored: style.css follows the OS setting. */
  function loadDisplay() {
    let saved = null;
    const raw = readStorage(DISPLAY_KEY);
    if (raw) {
      try {
        saved = JSON.parse(raw);
      } catch (error) {
        saved = null;
      }
    }
    const theme = saved && typeof saved === 'object' ? saved.theme : null;
    state.theme = theme === 'light' || theme === 'dark' ? theme : 'dark';
  }

  /* aria-label from data-i18n-label; an icon-only button gets the same text as its title. */
  function labelElement(element) {
    const text = t(element.dataset.i18nLabel);
    element.setAttribute('aria-label', text);
    if (element.classList.contains('icon-button')) element.title = text;
  }

  function applyDisplay() {
    document.documentElement.dataset.theme = state.theme;
    /* While the page is dark the button shows the sun and offers light, and the
     * other way round; the label names the state the click leads to. */
    const toggle = $('theme-toggle');
    const dark = state.theme === 'dark';
    /* SVG elements have no `hidden` property, so the attribute is toggled directly. */
    toggle.querySelector('.icon-sun').toggleAttribute('hidden', !dark);
    toggle.querySelector('.icon-moon').toggleAttribute('hidden', dark);
    toggle.dataset.i18nLabel = dark ? 'theme.toLight' : 'theme.toDark';
    labelElement(toggle);
  }

  function saveDisplay() {
    writeStorage(DISPLAY_KEY, JSON.stringify({ theme: state.theme }));
  }

  /* ---- presets ---- */

  const digestHexOf = text => core.hash(encoder.encode(text)).digestHex;

  function day117() {
    if (!day117Cache) day117Cache = presets.day117.build(digestHexOf);
    return day117Cache;
  }

  function presetInput(preset) {
    if (preset.mode === 'hex') return preset.hex;
    return typeof preset.derive === 'string' ? day117()[preset.derive] : preset.text;
  }

  function renderPresetOptions() {
    const select = $('preset-select');
    const first = select.options[0];
    const groups = new Map();
    for (const preset of presets.list) {
      if (!groups.has(preset.group)) {
        const group = node('optgroup');
        group.label = t('preset.group.' + preset.group);
        groups.set(preset.group, group);
      }
      const option = node('option', t('preset.' + preset.id));
      option.value = preset.id;
      groups.get(preset.group).append(option);
    }
    select.replaceChildren(first, ...groups.values());
    select.value = state.presetId || '';
  }

  function applyPreset(preset) {
    state.presetId = preset.id;
    state.mode = preset.mode;
    state.options = Object.assign({}, DEFAULT_OPTIONS, preset.options || {});
    const value = presetInput(preset);
    if (preset.mode === 'hex') state.hexText = value;
    else state.text = value;
    writeInputFields();
    recompute();
  }

  /* The text areas are written only here (preset or URL), never on each render, so the
   * caret of a typing user is left alone. The textarea normalizes CR and CRLF to LF;
   * the state keeps the original string. */
  function writeInputFields() {
    $('text-input').value = state.text;
    $('hex-input').value = state.hexText;
  }

  /* Called when the user edits the input by hand: the preset no longer applies and the
   * one-time notices about the URL are cleared. */
  function userEdited() {
    state.presetId = null;
    if (state.error === 'fragment' || state.error === 'fragmentLimit') state.error = null;
  }

  /* ---- computation ---- */

  function recompute() {
    stopPlay();
    state.bytes = null;
    state.chars = null;
    state.stats = null;
    state.warnings = [];
    state.inputError = null;
    state.result = null;
    state.traces = [];
    state.request += 1;
    if (state.error === 'match') state.error = null;
    try {
      if (state.mode === 'text') {
        const encoded = input.encodeText(state.text, state.options);
        state.bytes = encoded.bytes;
        state.chars = encoded.chars;
        state.stats = encoded.stats;
        if (encoded.stats.loneSurrogates > 0) {
          state.warnings.push({ key: 'warning.lone-surrogate', values: { n: encoded.stats.loneSurrogates } });
        }
      } else {
        const parsed = input.parseHex(state.hexText);
        for (const warning of parsed.warnings) state.warnings.push({ key: 'warning.' + warning });
        if (parsed.ok) state.bytes = parsed.bytes;
        else state.inputError = { kind: 'hex', error: parsed.error };
      }
      if (state.bytes && state.bytes.length > BYTE_LIMIT) {
        state.inputError = { kind: 'limit' };
        state.bytes = null;
        state.chars = null;
      }
      if (state.bytes) {
        state.result = core.hash(state.bytes);
        clampPosition();
        checkWithWebCrypto();
      }
    } catch (error) {
      state.result = null;
      state.bytes = null;
      state.error = 'generic';
    }
    render();
  }

  function clampPosition() {
    const position = state.position;
    if (position.block !== null && position.block >= state.result.blocks) {
      position.block = state.result.blocks - 1;
    }
  }

  /* Compares the pure JavaScript digest with crypto.subtle. The request number lets a
   * late answer for an older input be ignored. */
  function checkWithWebCrypto() {
    const subtle = globalThis.crypto && globalThis.crypto.subtle;
    const result = state.result;
    if (!subtle) {
      state.cryptoStatus = 'unknown';
      return;
    }
    state.cryptoStatus = 'pending';
    const request = state.request;
    const settle = status => {
      if (request !== state.request || state.result !== result) return;
      state.cryptoStatus = status;
      if (status === 'ng') state.error = 'match';
      else if (state.error === 'match') state.error = null;
      renderError();
      /* While typing the computation section is waiting for the keys to be still; the
       * answer only touches it when Web Crypto disagrees (the boards are then hidden). */
      if (computeTimer && status !== 'ng') {
        renderRail();
        renderClock();
      } else {
        renderPosition(false);
      }
      renderResult();
      renderDropped();
    };
    let promise;
    try {
      promise = subtle.digest('SHA-256', result.bytes);
    } catch (error) {
      state.cryptoStatus = 'unknown';
      return;
    }
    promise.then(buffer => {
      settle(core.hexBytes(new Uint8Array(buffer), '') === result.digestHex ? 'ok' : 'ng');
    }, () => settle('unknown'));
  }

  function traceFor(block) {
    if (!state.traces[block]) state.traces[block] = core.traceBlock(state.result, block);
    return state.traces[block];
  }

  function boardsVisible() {
    return state.result !== null && state.cryptoStatus !== 'ng';
  }

  /* ---- position on the stage clock ---- */

  function totalSteps() {
    return core.stepCount(state.result.blocks);
  }

  function stepIndex() {
    return core.stepOf(state.result.blocks, state.position);
  }

  function positionModel() {
    return view.positionModel(state.result, state.position);
  }

  /* The block number is named only when the message has two blocks or more (and not
   * for the padding, which belongs to the whole message). */
  function blockText(m) {
    if (m.blocks < 2 || m.blockNumber === null || m.phase === 'pad') return '';
    return t('rail.block', { n: m.blockNumber, total: m.blocks });
  }

  function positionText(model) {
    const m = model || positionModel();
    const label = t(m.labelKey, { t: m.index });
    const block = blockText(m);
    return block ? block + ' ' + label : label;
  }

  /* Moves the clock to step k. `announce` writes the live region (manual steps only);
   * `reveal` scrolls the current row into view (manual steps and autoplay). */
  function goToStep(k, announce, reveal) {
    if (!state.result) return;
    const clamped = Math.max(0, Math.min(totalSteps() - 1, k));
    state.position = core.stepAt(state.result.blocks, clamped);
    renderPosition(reveal);
    if (announce) $('announcement').textContent = positionText();
  }

  /* Step indices where a phase starts: padding, then split, W[16], round 0 and the
   * final addition of every block, then the digest. */
  function phaseStarts() {
    const blocks = state.result.blocks;
    const list = [0];
    for (let b = 0; b < blocks; b += 1) {
      list.push(core.stepOf(blocks, { phase: 'split', block: b, index: 0 }));
      list.push(core.stepOf(blocks, { phase: 'schedule', block: b, index: 16 }));
      list.push(core.stepOf(blocks, { phase: 'round', block: b, index: 0 }));
      list.push(core.stepOf(blocks, { phase: 'final', block: b, index: 0 }));
    }
    list.push(totalSteps() - 1);
    return list;
  }

  function blockStarts() {
    const blocks = state.result.blocks;
    const list = [0];
    for (let b = 0; b < blocks; b += 1) list.push(core.stepOf(blocks, { phase: 'split', block: b, index: 0 }));
    list.push(totalSteps() - 1);
    return list;
  }

  function nextStart(starts, k, direction) {
    if (direction > 0) {
      const next = starts.find(start => start > k);
      return next === undefined ? totalSteps() - 1 : next;
    }
    const earlier = starts.filter(start => start < k);
    return earlier.length ? earlier[earlier.length - 1] : 0;
  }

  function move(direction) {
    if (!state.result) return;
    const k = stepIndex();
    switch (state.granularity) {
      case 'eight':
        goToStep(k + 8 * direction, true, true);
        break;
      case 'phase':
        goToStep(nextStart(phaseStarts(), k, direction), true, true);
        break;
      case 'block':
        goToStep(nextStart(blockStarts(), k, direction), true, true);
        break;
      default:
        goToStep(k + direction, true, true);
    }
  }

  /* A rail button or a digit key: the clock moves to the start of the phase (in the
   * block being read) and the page scrolls to the panel that draws it. */
  function jumpToPhase(phase) {
    if (!state.result) return;
    const blocks = state.result.blocks;
    const block = state.position.block === null ? blocks - 1 : state.position.block;
    if (phase === 'pad') state.position = { phase: 'pad', block: 0, index: 0 };
    else if (phase === 'digest') state.position = { phase: 'digest', block: null, index: 0 };
    else state.position = { phase, block, index: phase === 'schedule' ? 16 : 0 };
    renderPosition(false);
    $('announcement').textContent = positionText();
    if (!boardsVisible()) return;
    const title = $('board-' + PANEL_OF[phase] + '-title');
    ownScrollUntil = performance.now() + OWN_SCROLL_WINDOW;
    title.scrollIntoView({ block: 'start' });
    title.focus({ preventScroll: true });
  }

  /* ---- rendering: controls, errors, statistics, byte grid ---- */

  function syncControls() {
    const hex = state.mode === 'hex';
    $('input-mode-text').checked = !hex;
    $('input-mode-hex').checked = hex;
    $('text-field').hidden = hex;
    $('hex-field').hidden = !hex;
    $('text-notes').hidden = hex;
    /* The heading of the bytes section names what the grid shows: the UTF-8 encoding
     * of the text, or the hex bytes as given. The key is kept on the element so that
     * localize() picks the same wording. */
    const bytesTitle = $('bytes-title-text');
    const bytesKey = hex ? 'section.bytesHex' : 'section.bytes';
    bytesTitle.dataset.i18n = bytesKey;
    bytesTitle.textContent = t(bytesKey);
    $('newline-select').value = state.options.newline;
    $('trailing-newline').checked = state.options.trailingNewline;
    $('bom-check').checked = state.options.bom;
    $('newline-select').disabled = hex;
    $('trailing-newline').disabled = hex;
    $('bom-check').disabled = hex;
    /* The settings section fades its labels with its disabled controls (style.css). */
    $('input-options').toggleAttribute('data-off', hex);
    $('preset-select').value = state.presetId || '';
    $('radix-select').value = state.radix;
    $('granularity').value = state.granularity;
  }

  function errorText(code) {
    switch (code) {
      case 'match':
        return t('result.match.ng');
      case 'fragment':
        return t('error.fragment');
      case 'fragmentLimit':
        return t('error.fragmentLimit', { max: formatNumber(FRAGMENT_LIMIT) });
      case 'cryptoUnavailable':
        return t('error.cryptoUnavailable');
      default:
        return t('error.generic');
    }
  }

  function renderError() {
    $('error').textContent = state.error ? errorText(state.error) : '';
  }

  function renderInputError() {
    const box = $('input-error');
    box.replaceChildren();
    const failure = state.inputError;
    if (!failure) return;
    if (failure.kind === 'limit') {
      box.textContent = t('error.limit', { max: formatNumber(BYTE_LIMIT) });
      return;
    }
    const error = failure.error;
    box.append(document.createTextNode(t('error.hex.' + error.code, {
      position: error.position, line: error.line, column: error.column, char: error.char, name: error.name
    })));
    /* The input around the offending character, which is underlined. Positions count
     * code points, so the string is sliced as an array of code points. */
    const points = Array.from(state.hexText);
    const at = error.position;
    const context = node('code', undefined, 'hex-context');
    context.append(
      document.createTextNode(points.slice(Math.max(0, at - ERROR_CONTEXT), at).join('')),
      node('u', points.slice(at, at + 1).join('')),
      document.createTextNode(points.slice(at + 1, at + 1 + ERROR_CONTEXT).join(''))
    );
    box.append(node('br'), context);
  }

  function renderStats() {
    const box = $('input-stats');
    box.replaceChildren();
    const chip = (label, value) => {
      const element = node('div');
      element.append(node('span', label), node('strong', value, 'value'));
      return element;
    };
    const flag = text => {
      const element = node('div');
      element.append(node('span', text));
      return element;
    };
    if (state.mode === 'text' && state.stats) {
      const s = state.stats;
      box.append(
        chip(t('stats.codePoints'), formatNumber(s.codePoints)),
        chip(t('stats.utf16'), formatNumber(s.utf16Units)),
        chip(t('stats.bytes'), formatNumber(s.byteCount)),
        chip(t('stats.blocks'), formatNumber(core.blockCount(s.byteCount))),
        flag(t('stats.newlines', { lf: s.lf, crlf: s.crlf, cr: s.cr })),
        flag(t('stats.trailing.' + s.trailingNewline))
      );
      if (s.bom) box.append(flag(t('stats.bom')));
      box.append(flag(t('stats.normalization.' + s.normalization)));
    } else if (state.mode === 'hex' && state.bytes) {
      box.append(
        chip(t('stats.bytes'), formatNumber(state.bytes.length)),
        chip(t('stats.blocks'), formatNumber(core.blockCount(state.bytes.length)))
      );
    }
    for (const warning of state.warnings) box.append(node('div', t(warning.key, warning.values), 'warning'));
  }

  /* The byte grid and its legend. The legend lists the classes other than plain text
   * that the grid holds, each with the first byte of the first such character as its
   * swatch (0a for LF); it stays hidden while the grid is all text. */
  function renderGrid() {
    const grid = $('byte-grid');
    const legend = $('byte-legend');
    const caption = legend.querySelector('.legend-caption');
    grid.replaceChildren();
    legend.replaceChildren(caption);
    legend.hidden = true;
    if (!state.bytes) return;
    const chars = state.mode === 'text' ? state.chars : null;
    const model = view.byteGrid(state.bytes, chars, { perRow: PER_ROW, coloredLimit: COLORED_LIMIT });
    const seen = new Map();
    for (const row of model.rows) {
      const line = node('div', undefined, 'byte-row');
      line.append(node('span', row.offset.toString(16).padStart(4, '0'), 'byte-offset'));
      const cells = node('div', undefined, 'byte-cells');
      for (const cell of row.cells) {
        const element = node('span', cell.hex, 'byte-cell');
        element.dataset.cls = cell.cls;
        if (chars && cell.charIndex !== null) {
          element.title = input.unicodeName(chars[cell.charIndex].cp);
          if (cell.cls !== 'text' && !seen.has(cell.cls)) seen.set(cell.cls, cell.hex);
        }
        cells.append(element);
      }
      line.append(cells);
      grid.append(line);
    }
    if (model.plainRows.length) grid.append(node('pre', model.plainRows.join('\n'), 'byte-plain'));
    for (const [cls, hex] of seen) {
      const item = node('li');
      const swatch = node('span', hex, 'legend-swatch');
      swatch.dataset.cls = cls;
      item.append(swatch, node('span', t('cls.' + cls)));
      legend.append(item);
    }
    legend.hidden = seen.size === 0;
  }

  /* ---- rendering: stage rail, position line, clock ---- */

  /* Brings the current step's button into the visible part of the rail when the rail
   * scrolls horizontally (narrow screens). Only the rail's own scrollLeft moves, by the
   * smallest amount: scrollIntoView would also scroll the page vertically whenever the
   * rail is above or below the fold, for example while stepping with the clock. */
  function revealRailButton(button) {
    /* Whether the rail overflows is measured on resize (updateClockHeight), so a wide
     * screen does not read the layout on every step. */
    if (!railOverflows) return;
    const rail = $('stage-rail');
    const outer = rail.getBoundingClientRect();
    const inner = button.getBoundingClientRect();
    if (inner.left < outer.left) rail.scrollLeft -= outer.left - inner.left + 4;
    else if (inner.right > outer.right) rail.scrollLeft += inner.right - outer.right + 4;
  }

  function renderRail() {
    const phase = state.result ? state.position.phase : null;
    for (const button of $('stage-rail').querySelectorAll('button')) {
      if (button.dataset.phase === phase) {
        button.setAttribute('aria-current', 'step');
        revealRailButton(button);
      } else button.removeAttribute('aria-current');
      button.disabled = !state.result;
    }
    if (!state.result) {
      $('position-block').textContent = '';
      $('position-index').textContent = '';
      return;
    }
    const m = positionModel();
    $('position-block').textContent = blockText(m);
    $('position-index').textContent = t(m.labelKey, { t: m.index });
  }

  function renderClock() {
    const range = $('clock-range');
    const has = state.result !== null;
    for (const id of ['clock-first', 'clock-prev', 'clock-play', 'clock-next', 'clock-last']) $(id).disabled = !has;
    $('clock-speed').disabled = !has;
    range.disabled = !has;
    if (!has) {
      range.max = '0';
      range.value = '0';
      range.setAttribute('aria-valuetext', '');
      $('clock-position').textContent = '';
      scheduleLayout();
      return;
    }
    const m = positionModel();
    const text = positionText(m);
    range.max = String(m.total - 1);
    range.value = String(m.stepIndex);
    range.setAttribute('aria-valuetext', text);
    /* The same words as the position line, next to the heading of the clock. */
    $('clock-position').textContent = text;
    scheduleLayout();
  }

  function renderPosition(reveal) {
    renderRail();
    updateCompute(reveal === true);
    renderClock();
    $('copy-worksheet').disabled = !(boardsVisible() && state.position.phase === 'round');
  }

  /* ---- autoplay ---- */

  function speedFactor() {
    const value = Number($('clock-speed').value);
    return value > 0 ? value : 1;
  }

  function renderPlayButton() {
    const button = $('clock-play');
    button.setAttribute('aria-pressed', String(playing));
    button.dataset.i18nLabel = playing ? 'clock.pause' : 'clock.play';
    labelElement(button);
    button.textContent = playing ? PAUSE_GLYPH : PLAY_GLYPH;
  }

  /* One timer at a time; a speed change re-arms it with the new interval. */
  function armPlay(cost) {
    window.clearTimeout(playTimer);
    const delay = Math.max(PLAY_INTERVAL / speedFactor(), (cost || 0) * PLAY_IDLE_FACTOR);
    /* Wait for the frame of this step to be painted before counting the delay, so a
     * fast speed on a slow machine never queues steps back to back. */
    window.requestAnimationFrame(() => {
      if (!playing) return;
      window.clearTimeout(playTimer);
      playTimer = window.setTimeout(tickPlay, delay);
    });
  }

  /* Advances one step per tick, silently for the live region, scrolling the current
   * row into view, and stops at the last step. */
  function tickPlay() {
    playTimer = 0;
    if (!playing || !state.result) {
      stopPlay();
      return;
    }
    const last = totalSteps() - 1;
    const k = stepIndex();
    if (k >= last) {
      stopPlay();
      return;
    }
    const started = performance.now();
    goToStep(k + 1, false, true);
    const cost = performance.now() - started;
    if (stepIndex() >= last) {
      stopPlay();
      return;
    }
    armPlay(cost);
  }

  function startPlay() {
    if (!state.result || playing) return;
    if (stepIndex() >= totalSteps() - 1) goToStep(0, false, true);
    playing = true;
    renderPlayButton();
    armPlay();
  }

  /* Stopping announces the position once (autoplay itself keeps the live region quiet). */
  function stopPlay() {
    window.clearTimeout(playTimer);
    playTimer = 0;
    if (!playing) return;
    playing = false;
    renderPlayButton();
    if (state.result) $('announcement').textContent = positionText();
  }

  function togglePlay() {
    if (playing) stopPlay();
    else startPlay();
  }

  /* ---- following the clock on the page ---- */

  function noteUserScroll() {
    userScrollAt = performance.now();
  }

  function clockHeight() {
    return clockHeightCache || $('clock').offsetHeight;
  }

  /* Scrolls so that `anchor` (the current row) is visible above the fixed clock, then,
   * as far as the anchor can rise to the top of the window, so that `tail` (the bands
   * inserted under it) shows too. Nothing moves within a second of the user's own
   * wheel, touch or scrollbar scroll. */
  function scrollToShow(anchor, tail) {
    if (performance.now() - userScrollAt < FOLLOW_PAUSE) return;
    /* One layout read and one scroll: scrollIntoView did the same but cost several
     * forced layouts per step on this long page. */
    const limit = window.innerHeight - clockHeight();
    const a = anchor.getBoundingClientRect();
    let delta = 0;
    if (a.top < 0) delta = a.top;
    else if (a.bottom > limit) delta = Math.min(a.bottom - limit, a.top);
    if (tail) {
      const b = tail.getBoundingClientRect();
      const need = b.bottom - limit - delta;
      if (need > 0) delta += Math.min(need, Math.max(0, a.top - delta));
    }
    if (delta !== 0) {
      ownScrollUntil = performance.now() + OWN_SCROLL_WINDOW;
      window.scrollBy(0, delta);
    }
  }

  function wireScroll() {
    window.addEventListener('wheel', noteUserScroll, { passive: true });
    window.addEventListener('touchmove', noteUserScroll, { passive: true });
    window.addEventListener('scroll', () => {
      if (performance.now() > ownScrollUntil) noteUserScroll();
    }, { passive: true });
  }

  /* ---- rendering: words, bands, sums (built once, filled on every step) ---- */

  function wordText(w) {
    return w[state.radix];
  }

  /* The raw sum before the reduction mod 2^32, with the dropped digits in front of an
   * underscore: 1_54da50e8 in hex, the 33-bit form in binary, the plain value in decimal. */
  function rawText(s) {
    if (state.radix === 'dec') return String(s.raw);
    if (state.radix === 'bin') {
      const bin = s.raw.toString(2).padStart(33, '0');
      return bin.slice(0, bin.length - 32) + '_' + bin.slice(bin.length - 32);
    }
    return s.rawHex.slice(0, 1) + '_' + s.rawHex.slice(1);
  }

  let bitsTemplate = null;

  /* A row of 32 bit cells, cloned from one template (much cheaper than 32 createElement
   * calls when thousands of cells are built at once). */
  function bitsRow() {
    if (!bitsTemplate) {
      bitsTemplate = node('div', undefined, 'bits');
      for (let i = 0; i < 32; i += 1) bitsTemplate.append(node('span', '0', 'bit'));
    }
    return bitsTemplate.cloneNode(true);
  }

  /* Writes 32 bits into existing cells: the digit, the filled class for a 1 and any
   * extra class `extra(i, bit)` names (role borders, selections). */
  function fillBits(cells, bitList, extra) {
    for (let i = 0; i < 32; i += 1) {
      const bit = bitList[i];
      let className = bit === 1 ? 'bit is-one' : 'bit';
      if (extra) {
        const more = extra(i, bit);
        if (more) className += ' ' + more;
      }
      const cell = cells[i];
      const digit = bit === 1 ? '1' : '0';
      /* Only changed cells are written: an unchanged write still invalidates style
       * and layout, and the section holds some three thousand cells. */
      if (cell.firstChild === null || cell.firstChild.data !== digit) cell.textContent = digit;
      if (cell.className !== className) cell.className = className;
    }
  }

  function tileView(label, className) {
    const element = node('span', undefined, 'tile' + (className ? ' ' + className : ''));
    const labelEl = label === undefined ? null : node('span', label, 'tile-label');
    if (labelEl) element.append(labelEl);
    const value = node('span', '');
    element.append(value);
    return { element, label: labelEl, value };
  }

  function tilesView(labels, classOf) {
    const element = node('div', undefined, 'tiles');
    const items = labels.map((label, i) => tileView(label, classOf ? classOf(label, i) : undefined));
    for (const item of items) element.append(item.element);
    return { element, items };
  }

  function fillTiles(tv, list, labels) {
    tv.items.forEach((item, i) => {
      if (labels && item.label) item.label.textContent = labels[i];
      item.value.textContent = wordText(list[i]);
    });
  }

  /* A 32-bit band: label and value tile on one line, the bits below (or beside, when
   * wide). `withTile` false leaves the vote counts of Maj without a value tile. */
  function laneView(label, role, withTile) {
    const element = node('div', undefined, 'lane' + (role ? ' ' + role : ''));
    const head = node('div', undefined, 'lane-head');
    const labelEl = node('span', label, 'lane-label');
    head.append(labelEl);
    let tile = null;
    if (withTile !== false) {
      tile = node('span', '', 'tile');
      head.append(tile);
    }
    const row = bitsRow();
    element.append(head, row);
    return { element, label: labelEl, tile, cells: Array.from(row.children) };
  }

  function fillLane(lane, w, extra) {
    if (lane.tile) lane.tile.textContent = wordText(w);
    fillBits(lane.cells, w.bits, extra);
  }

  /* Maj: the number of 1s among a, b and c in each column; two or more light the cell. */
  function fillVotes(lane, votes) {
    for (let i = 0; i < 32; i += 1) {
      const cell = lane.cells[i];
      cell.textContent = String(votes[i]);
      cell.className = votes[i] >= 2 ? 'bit is-one' : 'bit';
    }
  }

  function sumRowView(label, className) {
    const element = node('div', undefined, 'sum-row' + (className ? ' ' + className : ''));
    const labelEl = node('span', label);
    const value = node('span', '');
    element.append(labelEl, value);
    return { element, label: labelEl, value };
  }

  /* Terms, raw sum, dropped carries and (unless `withOut` is false) the result mod 2^32. */
  function sumView(labels, withOut) {
    const element = node('div', undefined, 'sum');
    const terms = labels.map(label => sumRowView(label));
    const raw = sumRowView(t('board.raw'));
    const dropped = sumRowView('', 'sum-dropped');
    const out = withOut === false ? null : sumRowView(t('board.out'), 'is-result');
    element.append(...terms.map(row => row.element), raw.element, dropped.element);
    if (out) element.append(out.element);
    return { element, terms, raw, dropped, out };
  }

  function fillSum(sv, list, s, labels) {
    sv.terms.forEach((row, i) => {
      if (labels && labels[i] !== undefined) row.label.textContent = labels[i];
      row.value.textContent = wordText(list[i]);
    });
    sv.raw.value.textContent = rawText(s);
    sv.dropped.label.textContent = t('board.dropped', { n: s.dropped });
    sv.dropped.value.textContent = s.dropped > 0 ? t('board.overflow') : '';
    if (sv.out) sv.out.value.textContent = wordText(s.out);
  }

  function note(text) {
    return node('p', text, 'board-note');
  }

  const wIndex = i => 'W[' + i + ']';

  /* ---- rendering: the computation section, panel by panel ---- */

  /* The padding segment a byte of the padded message belongs to. */
  function byteKind(layout, offset) {
    if (offset < layout.messageEnd) return 'message';
    if (offset === layout.oneBit) return 'one';
    if (offset < layout.lengthStart) return 'zeros';
    return 'length';
  }

  function segmentLabel(kind, count, bitLen) {
    switch (kind) {
      case 'message':
        return t('board.pad.message');
      case 'one':
        return t('board.pad.one');
      case 'zeros':
        return t('board.pad.zeros', { count: formatNumber(count) });
      default:
        return t('board.pad.length', { bits: formatNumber(bitLen) });
    }
  }

  function segmentHex(kind, bytes) {
    if (kind === 'message' && bytes.length > PAD_EDGE_BYTES * 2) {
      return core.hexBytes(bytes.subarray(0, PAD_EDGE_BYTES), ' ') + ' ' + ELLIPSIS + ' ' +
        core.hexBytes(bytes.subarray(bytes.length - PAD_EDGE_BYTES), ' ');
    }
    if (kind === 'zeros' && bytes.length > 4) return '00 00 ' + ELLIPSIS + ' 00 00';
    return core.hexBytes(bytes, ' ');
  }

  /* The strip of padding segments that fall inside block b: label and hex per segment. */
  function paddingStrip(result, block, m) {
    const strip = node('div', undefined, 'padding-segments');
    const start = block * 64;
    const end = start + 64;
    for (const segment of m.segments) {
      const from = Math.max(segment.start, start);
      const to = Math.min(segment.end, end);
      if (to <= from) continue;
      const bytes = result.padded.subarray(from, to);
      const element = node('span', undefined, 'segment is-' + segment.kind);
      element.append(node('span', segmentLabel(segment.kind, to - from, m.bitLen), 'tile-label'), document.createTextNode(segmentHex(segment.kind, bytes)));
      strip.append(element);
    }
    return strip;
  }

  /* A word row: index, value tile, tag slot and the 32 bits. The view keeps the tile
   * and the cells so that a new result can be written into the same row. */
  function wordRow(index, w, tag, extra) {
    const row = node('div', undefined, 'w-row');
    const tile = node('span', wordText(w), 'tile');
    const tagEl = node('span', tag || '', 'w-tag');
    row.append(node('span', wIndex(index), 'w-index'), tile, tagEl);
    const bits = bitsRow();
    const cells = Array.from(bits.children);
    fillBits(cells, w.bits, extra);
    row.append(bits);
    return { element: row, tag: tagEl, tile, cells };
  }

  function fillWordRow(row, w, extra) {
    row.tile.textContent = wordText(w);
    fillBits(row.cells, w.bits, extra);
  }

  /* The padding segment class of every byte of block b, by word and byte (8 bits each). */
  function blockKinds(result, block) {
    const base = block * 64;
    return Array.from({ length: 16 }, (unused, t) => [0, 1, 2, 3].map(j => 'k-' + byteKind(result.layout, base + t * 4 + j)));
  }

  /* (a) The message block: the ordinal buttons (two blocks or more), the padding strip,
   * the 16 words as bit rows whose borders name the padding segment of each byte. */
  function buildBlockPanel(cv, result, trace) {
    const body = $('board-block').querySelector('.board-body');
    const m = view.paddingModel(result);
    const bm = view.blockModel(trace);
    const parts = [];
    if (result.blocks >= 2) {
      const tabs = node('div', undefined, 'block-tabs');
      tabs.setAttribute('role', 'group');
      tabs.setAttribute('aria-label', t('compute.block.tabs'));
      for (let b = 0; b < result.blocks; b += 1) {
        const button = node('button', t('compute.block.tab', { n: b + 1 }));
        button.type = 'button';
        button.dataset.block = String(b);
        if (b === cv.block) button.setAttribute('aria-current', 'true');
        button.addEventListener('click', () => {
          if (!state.result || b >= state.result.blocks) return;
          goToStep(core.stepOf(state.result.blocks, { phase: 'split', block: b, index: 0 }), true, false);
        });
        tabs.append(button);
      }
      parts.push(tabs);
    }
    cv.strip = paddingStrip(result, cv.block, m);
    parts.push(cv.strip);
    cv.blockRows = node('div', undefined, 'w-rows');
    cv.blockRowViews = new Array(16);
    const kinds = blockKinds(result, cv.block);
    for (const row of bm.rows) {
      const rowView = wordRow(row.t, row.word, '', i => kinds[row.t][i >> 3]);
      cv.blockRowViews[row.t] = rowView;
      cv.blockRows.append(rowView.element);
    }
    parts.push(cv.blockRows, note(t('compute.block.note')));
    if (cv.block === result.blocks - 1) parts.push(note(t('compute.block.lengthNote')));
    parts.push(note(t('board.pad.blocks', { n: m.blocks }) + ' ' + t('board.pad.boundary')));
    body.replaceChildren(...parts);
  }

  /* The bands of the current schedule word, slotted under its row. */
  function buildScheduleInsert() {
    const element = node('div', undefined, 'insert insert-schedule');
    const refs = tilesView(['', '', '', ''], () => 'is-ref');
    const head0 = node('h4', '');
    const s0 = {
      x: laneView('', ''),
      rotr7: laneView(t('board.schedule.rotr', { n: 7 }), 'role2'),
      rotr18: laneView(t('board.schedule.rotr', { n: 18 }), 'role2'),
      shr3: laneView(t('board.schedule.shr', { n: 3 }), 'role3'),
      out: laneView(t('board.schedule.sigma0'), 'role4')
    };
    const head1 = node('h4', '');
    const s1 = {
      x: laneView('', ''),
      rotr17: laneView(t('board.schedule.rotr', { n: 17 }), 'role2'),
      rotr19: laneView(t('board.schedule.rotr', { n: 19 }), 'role2'),
      shr10: laneView(t('board.schedule.shr', { n: 10 }), 'role3'),
      out: laneView(t('board.schedule.sigma1'), 'role4')
    };
    const sum = sumView(['', t('board.schedule.sigma0'), '', t('board.schedule.sigma1')]);
    const result = laneView('', 'role4');
    element.append(
      node('h4', t('board.schedule.refs')), refs.element,
      head0, s0.x.element, s0.rotr7.element, s0.rotr18.element, s0.shr3.element, s0.out.element,
      head1, s1.x.element, s1.rotr17.element, s1.rotr19.element, s1.shr10.element, s1.out.element,
      node('h4', t('board.schedule.sum')), sum.element, result.element
    );
    const sigma0 = t('board.schedule.sigma0');
    const sigma1 = t('board.schedule.sigma1');
    return {
      element,
      fill(m) {
        const r = m.refs;
        fillTiles(refs, [r.t16.word, r.t15.word, r.t7.word, r.t2.word], [wIndex(r.t16.index), wIndex(r.t15.index), wIndex(r.t7.index), wIndex(r.t2.index)]);
        head0.textContent = sigma0 + '(' + wIndex(r.t15.index) + ')';
        s0.x.label.textContent = wIndex(r.t15.index);
        fillLane(s0.x, m.s0.x);
        fillLane(s0.rotr7, m.s0.rotr7);
        fillLane(s0.rotr18, m.s0.rotr18);
        fillLane(s0.shr3, m.s0.shr3);
        fillLane(s0.out, m.s0.out);
        head1.textContent = sigma1 + '(' + wIndex(r.t2.index) + ')';
        s1.x.label.textContent = wIndex(r.t2.index);
        fillLane(s1.x, m.s1.x);
        fillLane(s1.rotr17, m.s1.rotr17);
        fillLane(s1.rotr19, m.s1.rotr19);
        fillLane(s1.shr10, m.s1.shr10);
        fillLane(s1.out, m.s1.out);
        fillSum(sum, m.sum.terms, m.sum, [wIndex(r.t16.index), undefined, wIndex(r.t7.index), undefined]);
        result.label.textContent = wIndex(m.t);
        fillLane(result, m.sum.out);
      }
    };
  }

  function legendItem(className, text) {
    const item = node('li');
    item.append(node('span', undefined, 'legend-key ' + className), node('span', text));
    return item;
  }

  /* (b) The message schedule: the legend of the row colors, then W[0] to W[63] as bit
   * rows (the first 16 tagged "from the block"); the current word's bands are inserted
   * under its row by setScheduleCurrent. */
  function buildSchedulePanel(cv, trace) {
    const body = $('board-schedule').querySelector('.board-body');
    const legend = node('ul', undefined, 'row-legend');
    legend.append(
      legendItem('is-current', t('compute.schedule.legend.current')),
      legendItem('is-direct', t('compute.schedule.legend.direct')),
      legendItem('is-sigma', t('compute.schedule.legend.sigma'))
    );
    const rows = node('div', undefined, 'w-rows');
    cv.scheduleRows = new Array(64);
    cv.scheduleTags = new Array(64);
    cv.scheduleRowViews = new Array(64);
    const fromBlock = t('compute.schedule.fromBlock');
    for (let i = 0; i < 64; i += 1) {
      const row = wordRow(i, view.word(trace.W[i]), i < 16 ? fromBlock : '');
      cv.scheduleRows[i] = row.element;
      cv.scheduleTags[i] = row.tag;
      cv.scheduleRowViews[i] = row;
      rows.append(row.element);
    }
    cv.scheduleInsert = buildScheduleInsert();
    body.replaceChildren(legend, note(t('board.schedule.fromBlock')), rows);
  }

  /* The bands of the current round, slotted under the working variables. */
  function buildRoundInsert() {
    const element = node('div', undefined, 'insert insert-round');
    const S1 = {
      x: laneView('e', ''),
      rotr6: laneView(t('board.schedule.rotr', { n: 6 }), 'role2'),
      rotr11: laneView(t('board.schedule.rotr', { n: 11 }), 'role2'),
      rotr25: laneView(t('board.schedule.rotr', { n: 25 }), 'role2'),
      out: laneView(t('board.round.S1'), 'role4')
    };
    const ch = { e: laneView('e', ''), f: laneView('f', 'role2'), g: laneView('g', 'role3'), out: laneView(t('board.round.ch'), 'role4') };
    const S0 = {
      x: laneView('a', ''),
      rotr2: laneView(t('board.schedule.rotr', { n: 2 }), 'role2'),
      rotr13: laneView(t('board.schedule.rotr', { n: 13 }), 'role2'),
      rotr22: laneView(t('board.schedule.rotr', { n: 22 }), 'role2'),
      out: laneView(t('board.round.S0'), 'role4')
    };
    const maj = { a: laneView('a', ''), b: laneView('b', 'role2'), c: laneView('c', 'role3'), votes: laneView('a+b+c', 'role2', false), out: laneView(t('board.round.maj'), 'role4') };
    const T1 = sumView(['h', t('board.round.S1'), t('board.round.ch'), t('board.round.K'), t('board.round.W')]);
    const T2 = sumView([t('board.round.S0'), t('board.round.maj')]);
    const newE = sumView(['d', 'T1']);
    const newA = sumView(['T1', 'T2']);
    const names = view.REGISTERS;
    const after = tilesView(names, name => (name === 'a' || name === 'e' ? 'is-result' : undefined));
    element.append(
      node('h4', t('board.round.S1')), S1.x.element, S1.rotr6.element, S1.rotr11.element, S1.rotr25.element, S1.out.element,
      node('h4', t('board.round.ch')), ch.e.element, ch.f.element, ch.g.element, ch.out.element,
      node('h4', t('board.round.S0')), S0.x.element, S0.rotr2.element, S0.rotr13.element, S0.rotr22.element, S0.out.element,
      node('h4', t('board.round.maj')), maj.a.element, maj.b.element, maj.c.element, maj.votes.element, maj.out.element,
      node('h4', t('board.round.T1')), T1.element,
      node('h4', t('board.round.T2')), T2.element,
      node('h4', t('board.round.newE')), newE.element,
      node('h4', t('board.round.newA')), newA.element,
      node('h4', t('board.round.after')), after.element, note(t('board.round.newly'))
    );
    return {
      element,
      fill(m) {
        fillLane(S1.x, m.S1.x);
        fillLane(S1.rotr6, m.S1.rotr6);
        fillLane(S1.rotr11, m.S1.rotr11);
        fillLane(S1.rotr25, m.S1.rotr25);
        fillLane(S1.out, m.S1.out);
        fillLane(ch.e, m.ch.e);
        fillLane(ch.f, m.ch.f, i => (m.ch.select[i] === 1 ? 'is-source' : ''));
        fillLane(ch.g, m.ch.g, i => (m.ch.select[i] === 0 ? 'is-source' : ''));
        fillLane(ch.out, m.ch.out);
        fillLane(S0.x, m.S0.x);
        fillLane(S0.rotr2, m.S0.rotr2);
        fillLane(S0.rotr13, m.S0.rotr13);
        fillLane(S0.rotr22, m.S0.rotr22);
        fillLane(S0.out, m.S0.out);
        fillLane(maj.a, m.maj.a);
        fillLane(maj.b, m.maj.b);
        fillLane(maj.c, m.maj.c);
        fillVotes(maj.votes, m.maj.votes);
        fillLane(maj.out, m.maj.out);
        fillSum(T1, m.T1.terms, m.T1);
        fillSum(T2, m.T2.terms, m.T2);
        fillSum(newE, [m.e.d, m.e.T1], m.e);
        fillSum(newA, [m.a.T1, m.a.T2], m.a);
        fillTiles(after, m.after);
      }
    };
  }

  /* One row of the round table: a button with the index and a to h after the round.
   * The view keeps the eight text nodes for refills. */
  function roundTableRow(trace, t) {
    const r = trace.rounds[t];
    const row = node('button', undefined, 'rt-row');
    row.type = 'button';
    row.dataset.t = String(t);
    row.append(node('span', String(t), 'rt-index'));
    const texts = view.REGISTERS.map((name, i) => {
      const cell = node('span', undefined, 'rt-cell');
      const text = document.createTextNode(core.hexWord(r.after[i]));
      cell.append(node('span', name, 'rt-key'), text);
      row.append(cell);
      return text;
    });
    return { element: row, texts };
  }

  function fillTableRow(rowView, after) {
    for (let i = 0; i < 8; i += 1) rowView.texts[i].data = core.hexWord(after[i]);
  }

  /* (c) The round: the working variables before the current round (a to h, then K[t]
   * and W[t]), the bands of the round under them (setRoundCurrent), and the table of all
   * 64 rounds; pressing a row moves the clock to that round. */
  function buildRoundPanel(cv, trace) {
    const body = $('board-round').querySelector('.board-body');
    cv.registersHead = node('h4', '');
    cv.registerBox = node('div', undefined, 'register-lanes');
    cv.registerLanes = view.REGISTERS.map(name => laneView(name, ''));
    for (const lane of cv.registerLanes) cv.registerBox.append(lane.element);
    cv.kwLanes = node('div', undefined, 'register-lanes kw-lanes');
    cv.kLane = laneView('', 'role2');
    cv.wLane = laneView('', 'role2');
    cv.kwLanes.append(cv.kLane.element, cv.wLane.element);
    cv.roundInsert = buildRoundInsert();
    const head = node('div', undefined, 'rt-head');
    head.setAttribute('aria-hidden', 'true');
    head.append(node('span', 't'));
    for (const name of view.REGISTERS) head.append(node('span', name));
    const table = node('div', undefined, 'round-table');
    cv.tableRows = new Array(64);
    cv.tableRowViews = new Array(64);
    table.append(head);
    for (let i = 0; i < 64; i += 1) {
      cv.tableRowViews[i] = roundTableRow(trace, i);
      cv.tableRows[i] = cv.tableRowViews[i].element;
      table.append(cv.tableRows[i]);
    }
    table.addEventListener('click', event => {
      const row = event.target.closest('.rt-row');
      if (!row || !state.result || cv.block >= state.result.blocks) return;
      goToStep(core.stepOf(state.result.blocks, { phase: 'round', block: cv.block, index: Number(row.dataset.t) }), true, false);
    });
    body.replaceChildren(cv.registersHead, cv.registerBox, cv.kwLanes, node('h4', t('compute.round.table')), note(t('compute.round.tableHint')), table);
  }

  /* (d) The final addition: H_in[i] + register = H_out[i] for the eight lanes, as bits
   * and in the chosen radix, with the raw sum and the dropped carry. */
  function buildFinalPanel(cv, trace) {
    const body = $('board-final').querySelector('.board-body');
    const m = view.finalModel(trace);
    const parts = [];
    if (cv.block > 0) parts.push(note(t('compute.block.chain')));
    cv.finalBox = node('div', undefined, 'final-lanes');
    cv.finalViews = m.lanes.map(item => {
      const group = node('div', undefined, 'final-lane');
      const lane = {
        hin: laneView(t('compute.final.hin', { i: item.i }), ''),
        reg: laneView(view.REGISTERS[item.i], 'role2'),
        sum: sumView([], false),
        hout: laneView(t('compute.final.hout', { i: item.i }), 'role4')
      };
      group.append(lane.hin.element, lane.reg.element, lane.sum.element, lane.hout.element);
      cv.finalBox.append(group);
      return lane;
    });
    fillFinalPanel(cv, m);
    parts.push(cv.finalBox);
    body.replaceChildren(...parts);
  }

  function fillFinalPanel(cv, m) {
    m.lanes.forEach((item, i) => {
      const lane = cv.finalViews[i];
      fillLane(lane.hin, item.h);
      fillLane(lane.reg, item.v);
      fillSum(lane.sum, [], item);
      fillLane(lane.hout, item.out);
    });
  }

  /* (e) The digest: the eight words as bits and the 64 digits that section 5 shows. */
  function buildDigestPanel(cv, result) {
    const body = $('board-digest').querySelector('.board-body');
    cv.digestBox = node('div', undefined, 'digest-lanes');
    cv.digestLanes = view.REGISTERS.map((unused, i) => {
      const lane = laneView(t('board.final.lane', { i }), 'role4');
      cv.digestBox.append(lane.element);
      return lane;
    });
    cv.digestCode = node('code', '', 'digest-hex');
    fillDigestPanel(cv, view.digestModel(result));
    body.replaceChildren(cv.digestBox, cv.digestCode, note(t('board.digest.concat')));
  }

  function fillDigestPanel(cv, m) {
    m.words.forEach((w, i) => fillLane(cv.digestLanes[i], w));
    cv.digestCode.textContent = m.hex64;
  }

  /* Builds the five panels for one block of the current result. Rebuilt only when the
   * block, the number of blocks, the language or the radix changes; a new result of the
   * same shape is written into the existing elements (refillCompute) and the clock just
   * moves the emphasis (updateCompute). */
  function buildCompute(block) {
    const result = state.result;
    const trace = traceFor(block);
    const cv = { result, trace, block, blocks: result.blocks, lang: language, radix: state.radix, current: { schedule: -1, refs: [], round: -1, registers: '' } };
    buildBlockPanel(cv, result, trace);
    buildSchedulePanel(cv, trace);
    buildRoundPanel(cv, trace);
    buildFinalPanel(cv, trace);
    buildDigestPanel(cv, result);
    computeView = cv;
  }

  /* A new result for the same block, block count, language and radix: every value is
   * written into the elements that exist (tiles, bit cells, table text), only the
   * padding strip is remade, and the drawn step is forgotten so that the next update
   * refills the bands of the current step. Typing in the input then costs a refill, not
   * a rebuild of some seven thousand elements. */
  function refillCompute(cv, block) {
    const result = state.result;
    const trace = traceFor(block);
    cv.result = result;
    cv.trace = trace;
    const strip = paddingStrip(result, block, view.paddingModel(result));
    strip.classList.toggle('is-current', cv.strip.classList.contains('is-current'));
    cv.strip.replaceWith(strip);
    cv.strip = strip;
    const kinds = blockKinds(result, block);
    for (const row of view.blockModel(trace).rows) fillWordRow(cv.blockRowViews[row.t], row.word, i => kinds[row.t][i >> 3]);
    for (let i = 0; i < 64; i += 1) fillWordRow(cv.scheduleRowViews[i], view.word(trace.W[i]));
    for (let i = 0; i < 64; i += 1) fillTableRow(cv.tableRowViews[i], trace.rounds[i].after);
    fillFinalPanel(cv, view.finalModel(trace));
    fillDigestPanel(cv, view.digestModel(result));
    const current = cv.current;
    if (current.schedule >= 0) cv.scheduleRows[current.schedule].classList.remove('is-current');
    for (const i of current.refs) {
      cv.scheduleRows[i].removeAttribute('data-ref');
      cv.scheduleTags[i].textContent = i < 16 ? t('compute.schedule.fromBlock') : '';
    }
    if (current.round >= 0) {
      cv.tableRows[current.round].classList.remove('is-current');
      cv.tableRows[current.round].removeAttribute('aria-current');
    }
    cv.current = { schedule: -1, refs: [], round: -1, registers: '' };
  }

  function clearCompute() {
    for (const name of PANELS) {
      const panel = $('board-' + name);
      panel.classList.remove('is-active');
      panel.querySelector('.board-body').replaceChildren();
    }
    computeView = null;
  }

  /* Schedule: the current row (t, or -1 for none) and the four rows it reads, tagged
   * t-16, t-15, t-7 and t-2; the bands of W[t] are filled and slotted under the row. */
  function setScheduleCurrent(cv, index) {
    const current = cv.current;
    if (current.schedule === index) return;
    if (current.schedule >= 0) cv.scheduleRows[current.schedule].classList.remove('is-current');
    for (const i of current.refs) {
      cv.scheduleRows[i].removeAttribute('data-ref');
      cv.scheduleTags[i].textContent = i < 16 ? t('compute.schedule.fromBlock') : '';
    }
    current.refs = [];
    current.schedule = index;
    if (index < 0) {
      cv.scheduleInsert.element.remove();
      return;
    }
    const row = cv.scheduleRows[index];
    row.classList.add('is-current');
    for (const n of [16, 15, 7, 2]) {
      const i = index - n;
      cv.scheduleRows[i].dataset.ref = String(n);
      cv.scheduleTags[i].textContent = t('compute.schedule.ref', { n });
      current.refs.push(i);
    }
    cv.scheduleInsert.fill(view.scheduleModel(cv.trace, index));
    row.after(cv.scheduleInsert.element);
  }

  /* Round: the working variables shown are those before the current round, before
   * round 0 while the clock is in an earlier phase, after round 63 once it has passed
   * the rounds. K[t], W[t], the bands and the table's current row exist only in the
   * round phase. */
  function setRoundCurrent(cv, phase, index) {
    const current = cv.current;
    const inRound = phase === 'round';
    const shown = inRound ? { t: index, after: false } : (phase === 'final' || phase === 'digest' ? { t: 63, after: true } : { t: 0, after: false });
    const key = (shown.after ? 'after' : 'before') + shown.t;
    if (current.registers !== key) {
      const r = cv.trace.rounds[shown.t];
      const list = shown.after ? r.after : r.before;
      cv.registersHead.textContent = t(shown.after ? 'compute.round.registersAfter' : 'compute.round.registers', { t: shown.t });
      cv.registerLanes.forEach((lane, i) => fillLane(lane, view.word(list[i])));
      current.registers = key;
    }
    if (!inRound) {
      cv.kwLanes.hidden = true;
      cv.roundInsert.element.remove();
      if (current.round >= 0) {
        cv.tableRows[current.round].classList.remove('is-current');
        cv.tableRows[current.round].removeAttribute('aria-current');
        current.round = -1;
      }
      return;
    }
    if (current.round !== index) {
      const m = view.roundModel(cv.trace, index);
      cv.kLane.label.textContent = 'K[' + index + ']';
      fillLane(cv.kLane, m.K);
      cv.wLane.label.textContent = wIndex(index);
      fillLane(cv.wLane, m.W);
      cv.roundInsert.fill(m);
      if (current.round >= 0) {
        cv.tableRows[current.round].classList.remove('is-current');
        cv.tableRows[current.round].removeAttribute('aria-current');
      }
      cv.tableRows[index].classList.add('is-current');
      cv.tableRows[index].setAttribute('aria-current', 'step');
      current.round = index;
    }
    cv.kwLanes.hidden = false;
    if (!cv.roundInsert.element.isConnected) cv.kwLanes.after(cv.roundInsert.element);
  }

  /* The element the clock scrolls to for a position, and the bands that should show
   * under it when there is room. */
  function revealTargets(cv, position) {
    switch (position.phase) {
      case 'pad':
        return [cv.strip, null];
      case 'split':
        return [$('board-block-title'), cv.blockRows];
      case 'schedule':
        return [cv.scheduleRows[position.index], cv.scheduleInsert.element];
      case 'round':
        return [cv.registersHead, cv.roundInsert.element];
      case 'final':
        return [$('board-final-title'), cv.finalBox];
      default:
        return [$('board-digest-title'), cv.digestBox];
    }
  }

  /* Moves the emphasis of the computation section to the current position, rebuilding
   * the panels first when the block, the block count, the language or the radix changed
   * and refilling them when only the result changed. */
  function updateCompute(reveal) {
    const section = $('compute');
    if (deferCompute && computeView && boardsVisible()) {
      /* While typing, keep the section as it was (marked stale) and redraw once the
       * keys are still; the output above is already up to date. */
      deferCompute = false;
      section.classList.add('is-stale');
      window.clearTimeout(computeTimer);
      computeTimer = window.setTimeout(() => {
        computeTimer = 0;
        updateCompute(false);
      }, COMPUTE_DELAY);
      return;
    }
    deferCompute = false;
    if (computeTimer) {
      window.clearTimeout(computeTimer);
      computeTimer = 0;
    }
    section.classList.remove('is-stale');
    if (!boardsVisible()) {
      clearCompute();
      return;
    }
    const position = state.position;
    const block = position.block === null ? state.result.blocks - 1 : position.block;
    const cv = computeView;
    if (!cv || cv.block !== block || cv.blocks !== state.result.blocks || cv.lang !== language || cv.radix !== state.radix) buildCompute(block);
    else if (cv.result !== state.result) refillCompute(cv, block);
    const current = computeView;
    const phase = position.phase;
    for (const name of PANELS) $('board-' + name).classList.toggle('is-active', PANEL_OF[phase] === name);
    current.strip.classList.toggle('is-current', phase === 'pad');
    current.blockRows.classList.toggle('is-current', phase === 'split');
    setScheduleCurrent(current, phase === 'schedule' ? position.index : -1);
    setRoundCurrent(current, phase, position.index);
    if (reveal) {
      const [anchor, tail] = revealTargets(current, position);
      scrollToShow(anchor, tail);
    }
  }

  /* ---- rendering: output section and overflow statistics ---- */

  /* One output group per 32-bit word of the digest, in the radix of the boards: 8 hex
   * digits, the 32 binary digits in four octets (a narrow band wraps between them),
   * or the decimal value. */
  function digestGroupText(w) {
    if (state.radix === 'bin') return w.bin.replace(/([01]{8})(?=[01])/g, '$1 ');
    return wordText(w);
  }

  /* The output section: match badge, the digest as 8 groups and the copy buttons. A
   * hex error or a Web Crypto mismatch empties the digest and disables the buttons. */
  function renderResult() {
    const badge = $('match-badge');
    const has = state.result !== null;
    badge.dataset.state = has ? state.cryptoStatus : 'unknown';
    badge.textContent = has ? t('result.match.' + state.cryptoStatus) : '';
    const groups = $('digest-groups');
    groups.replaceChildren();
    groups.dataset.radix = state.radix;
    const ok = boardsVisible();
    for (const id of COPY_IDS) $(id).disabled = !ok;
    $('copy-worksheet').disabled = !(ok && state.position.phase === 'round');
    if (ok) for (const w of view.digestModel(state.result).words) groups.append(node('span', digestGroupText(w)));
    /* Zero bytes of input have a hash too; the note says so while the input is empty. */
    $('result').querySelector('.result-note').hidden = !(ok && state.result.bytes.length === 0);
  }

  /* The overflow statistics at the end of the computation section. */
  function renderDropped() {
    const box = $('dropped-stats');
    box.textContent = '';
    if (!boardsVisible()) return;
    const d = view.droppedStats(state.result, state.traces);
    box.textContent = t('stage.dropped', {
      s: d.schedule.count, st: d.schedule.total, t: d.t1.count, tt: d.t1.total, f: d.final.count, ft: d.final.total, m: d.max
    });
  }

  function renderCompare() {
    const out = $('compare-result');
    out.replaceChildren();
    out.classList.remove('is-match', 'is-mismatch');
    if (state.compare.trim() === '') return;
    const c = view.compareDigest(state.compare, state.result ? state.result.digestHex : null);
    if (c.found.length === 0) {
      out.textContent = t('compare.none');
      return;
    }
    if (c.found.length > 1) {
      out.append(node('span', t('compare.multiple', { n: c.found.length })));
      const choices = node('span', undefined, 'actions');
      for (const candidate of c.found) {
        const button = node('button', candidate, 'mono');
        button.type = 'button';
        button.addEventListener('click', () => {
          state.compare = candidate;
          $('compare-input').value = candidate;
          renderCompare();
        });
        choices.append(button);
      }
      out.append(choices);
      return;
    }
    const normalized = node('span', t('compare.normalized') + ' ' + c.normalized, 'mono');
    if (c.match === null) {
      out.append(normalized);
      return;
    }
    out.classList.add(c.match ? 'is-match' : 'is-mismatch');
    out.append(node('span', t(c.match ? 'compare.match' : 'compare.mismatch')), node('br'), normalized);
  }

  /* ---- clipboard ---- */

  /* The read-only field that holds the text when the clipboard cannot be written. It
   * is placed right after the copy buttons of the output section. */
  function fallbackArea() {
    let area = $('copy-fallback');
    if (!area) {
      area = node('textarea');
      area.id = 'copy-fallback';
      area.readOnly = true;
      area.rows = 3;
      area.spellcheck = false;
      area.setAttribute('aria-label', t('copy.fallback'));
      $('result').querySelector('.result-actions').after(area);
    }
    return area;
  }

  async function copyText(text) {
    let done = false;
    if (window.isSecureContext && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(text);
        done = true;
      } catch (error) {
        done = false;
      }
    }
    if (done) {
      const area = $('copy-fallback');
      if (area) area.hidden = true;
      $('announcement').textContent = t('copy.done');
      return;
    }
    const area = fallbackArea();
    area.hidden = false;
    area.value = text;
    area.focus();
    area.select();
    $('announcement').textContent = t('copy.failed');
  }

  /* ---- help dialog ---- */

  /* The help is built from the help.* keys: what the tool does and does not do, how to
   * read the page and drive the clock, the keyboard, input tips, and the privacy line.
   * No links; references are named in text. */
  function buildHelp() {
    const body = $('help-body');
    const parts = [];
    parts.push(node('h3', t('help.can.title')));
    const can = node('ul');
    for (const key of ['help.can.1', 'help.can.2', 'help.can.3']) can.append(node('li', t(key)));
    parts.push(can);
    parts.push(node('h3', t('help.cannot.title')), node('p', t('help.cannot.body')));
    parts.push(node('h3', t('help.how.title')), node('p', t('help.how.body')), node('p', t('help.how.clock')));
    parts.push(node('h3', t('help.keys.title')));
    const keys = node('dl', undefined, 'help-keys');
    for (const [combo, key, separator] of HELP_KEYS) {
      const term = node('dt');
      combo.forEach((name, i) => {
        if (i > 0) term.append(document.createTextNode(separator));
        term.append(node('kbd', name));
      });
      keys.append(term, node('dd', t(key)));
    }
    parts.push(keys, node('p', t('help.keys.note'), 'muted'));
    parts.push(node('h3', t('help.input.title')), node('p', t('help.input.body')));
    parts.push(node('h3', t('help.privacy.title')), node('p', t('privacy')), node('p', t('help.reference'), 'muted'));
    body.replaceChildren(...parts);
  }

  function helpOpen() {
    return $('help-dialog').open === true;
  }

  /* Opens the modal and moves focus to its heading; closing (the button, Esc or a click
   * on the backdrop) returns focus to the help button. */
  function openHelp() {
    const dialog = $('help-dialog');
    if (dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    $('help-title').focus();
  }

  function closeHelp() {
    const dialog = $('help-dialog');
    if (!dialog.open) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  function wireHelp() {
    const dialog = $('help-dialog');
    $('help-title').tabIndex = -1;
    $('help-button').addEventListener('click', openHelp);
    $('help-close').addEventListener('click', closeHelp);
    /* A click whose target is the dialog element itself landed on the backdrop (the
     * inner box takes every click inside the dialog). */
    dialog.addEventListener('click', event => {
      if (event.target === dialog) closeHelp();
    });
    dialog.addEventListener('close', () => {
      $('help-button').focus();
    });
  }

  /* ---- layout variable: the fixed clock ---- */

  /* --clock-height is the clock's measured height plus a margin; the body's bottom
   * padding reads it so the output section and the footer can scroll clear of the
   * clock. style.css holds a fallback value. The clock is measured only while it is
   * visible (below 768px it hides while a text area has focus). */
  function updateClockHeight() {
    const rail = $('stage-rail');
    railOverflows = rail.scrollWidth > rail.clientWidth;
    const height = $('clock').offsetHeight;
    if (height === 0) return;
    document.documentElement.style.setProperty('--clock-height', (height + CLOCK_MARGIN) + 'px');
    clockHeightCache = height;
  }

  /* Resize events and position changes come in bursts; one measurement per animation
   * frame is enough. */
  function scheduleLayout() {
    if (layoutFrame) return;
    layoutFrame = window.requestAnimationFrame(() => {
      layoutFrame = 0;
      updateClockHeight();
    });
  }

  function wireLayout() {
    window.addEventListener('resize', scheduleLayout);
  }

  /* ---- whole page ---- */

  function render() {
    syncControls();
    renderError();
    renderInputError();
    renderStats();
    renderGrid();
    renderPosition(false);
    renderResult();
    renderDropped();
    renderCompare();
    scheduleLayout();
  }

  function localize() {
    document.documentElement.lang = language;
    document.title = t('title');
    document.querySelectorAll('[data-i18n]').forEach(element => {
      element.textContent = t(element.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-label]').forEach(labelElement);
    /* The language button is labelled with the name of the other language. */
    $('lang-toggle').setAttribute('lang', language === 'ja' ? 'en' : 'ja');
    $('compare-input').placeholder = t('compare.placeholder');
    const area = $('copy-fallback');
    if (area) area.setAttribute('aria-label', t('copy.fallback'));
    renderPresetOptions();
    renderPlayButton();
    buildHelp();
  }

  /* ---- events ---- */

  function wireInput() {
    for (const mode of ['text', 'hex']) {
      $('input-mode-' + mode).addEventListener('change', () => {
        if (!$('input-mode-' + mode).checked) return;
        state.mode = mode;
        userEdited();
        recompute();
      });
    }
    const textInput = $('text-input');
    const hexInput = $('hex-input');
    const onText = event => {
      if (event && event.isComposing) return;
      state.text = textInput.value;
      userEdited();
      deferCompute = true;
      recompute();
    };
    const onHex = event => {
      if (event && event.isComposing) return;
      state.hexText = hexInput.value;
      userEdited();
      deferCompute = true;
      recompute();
    };
    textInput.addEventListener('input', onText);
    textInput.addEventListener('compositionend', onText);
    hexInput.addEventListener('input', onHex);
    hexInput.addEventListener('compositionend', onHex);
    $('newline-select').addEventListener('change', () => {
      state.options.newline = $('newline-select').value === 'crlf' ? 'crlf' : 'lf';
      userEdited();
      recompute();
    });
    $('trailing-newline').addEventListener('change', () => {
      state.options.trailingNewline = $('trailing-newline').checked;
      userEdited();
      recompute();
    });
    $('bom-check').addEventListener('change', () => {
      state.options.bom = $('bom-check').checked;
      userEdited();
      recompute();
    });
    $('preset-select').addEventListener('change', () => {
      const preset = presets.list.find(item => item.id === $('preset-select').value);
      if (preset) applyPreset(preset);
      else {
        state.presetId = null;
        syncControls();
      }
    });
  }

  function wireStage() {
    for (const button of $('stage-rail').querySelectorAll('button')) {
      button.addEventListener('click', () => jumpToPhase(button.dataset.phase));
    }
    $('clock-first').addEventListener('click', () => goToStep(0, true, true));
    $('clock-last').addEventListener('click', () => { if (state.result) goToStep(totalSteps() - 1, true, true); });
    $('clock-prev').addEventListener('click', () => move(-1));
    $('clock-next').addEventListener('click', () => move(1));
    $('clock-play').addEventListener('click', togglePlay);
    $('clock-speed').addEventListener('change', () => { if (playing) armPlay(); });
    $('clock-range').addEventListener('input', () => goToStep(Number($('clock-range').value), true, true));
    $('granularity').addEventListener('change', () => {
      const value = $('granularity').value;
      state.granularity = GRANULARITIES.includes(value) ? value : 'step';
    });
    /* The radix applies to the tiles of the boards and to the digest of the output. */
    $('radix-select').addEventListener('change', () => {
      const value = $('radix-select').value;
      state.radix = RADIXES.includes(value) ? value : 'hex';
      renderPosition(false);
      renderResult();
    });
    /* Keys drive the clock while no text field, select or the help has the focus.
     * Space toggles autoplay unless a button or link has the focus (it activates that
     * element natively); "?" opens the help even without a result. */
    document.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      const tag = target && target.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      if (helpOpen()) return;
      if (event.key === '?') {
        event.preventDefault();
        openHelp();
        return;
      }
      if (!state.result) return;
      let handled = true;
      switch (event.key) {
        case 'ArrowRight':
          goToStep(stepIndex() + (event.shiftKey ? 8 : 1), true, true);
          break;
        case 'ArrowLeft':
          goToStep(stepIndex() - (event.shiftKey ? 8 : 1), true, true);
          break;
        case 'PageDown':
          goToStep(nextStart(phaseStarts(), stepIndex(), 1), true, true);
          break;
        case 'PageUp':
          goToStep(nextStart(phaseStarts(), stepIndex(), -1), true, true);
          break;
        case 'Home':
          goToStep(0, true, true);
          break;
        case 'End':
          goToStep(totalSteps() - 1, true, true);
          break;
        case ' ':
        case 'Spacebar':
          if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') handled = false;
          else togglePlay();
          break;
        default:
          if (/^[1-6]$/.test(event.key)) jumpToPhase(RAIL[Number(event.key) - 1]);
          else handled = false;
      }
      if (handled) event.preventDefault();
    });
    /* On phones the fixed clock and the keyboard would leave little room for a text
     * area, so the clock hides while one has focus. It comes back a moment after the
     * focus leaves: if it reappeared at once, a tap on a button near the bottom of the
     * screen (which blurs the text area first) would land on the clock instead. */
    const textAreaFocused = () => document.activeElement !== null && document.activeElement.tagName === 'TEXTAREA';
    document.addEventListener('focusin', event => {
      if (event.target && event.target.tagName === 'TEXTAREA' && matches('(max-width: 767px)')) $('clock').classList.add('is-hidden');
    });
    document.addEventListener('focusout', event => {
      if (!event.target || event.target.tagName !== 'TEXTAREA') return;
      window.setTimeout(() => {
        if (!textAreaFocused()) $('clock').classList.remove('is-hidden');
      }, CLOCK_RETURN_DELAY);
    });
  }

  function wireOutput() {
    const formats = () => view.copyFormats(state.result);
    const copyButton = (id, pick) => {
      $(id).addEventListener('click', () => {
        if (!boardsVisible()) return;
        perform(() => copyText(pick()));
      });
    };
    copyButton('copy-hash', () => formats().hex64);
    copyButton('copy-bytes-spaced', () => formats().bytesSpaced);
    copyButton('copy-bytes-joined', () => formats().bytesJoined);
    copyButton('copy-sha256sum', () => formats().sha256sum);
    $('copy-worksheet').addEventListener('click', () => {
      if (!boardsVisible() || state.position.phase !== 'round') return;
      const text = view.worksheet(state.result, traceFor(state.position.block), state.position.index, { lang: language });
      perform(() => copyText(text));
    });
    $('compare-input').addEventListener('input', () => {
      state.compare = $('compare-input').value;
      renderCompare();
    });
  }

  /* The round buttons at the right of the heading. The language switch redraws
   * everything from the state, so the input, the position and the digest stay. */
  function wireHeader() {
    $('lang-toggle').addEventListener('click', () => {
      language = language === 'ja' ? 'en' : 'ja';
      writeStorage(LANG_KEY, language);
      localize();
      render();
    });
    $('theme-toggle').addEventListener('click', () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      applyDisplay();
      saveDisplay();
    });
  }

  /* ---- start-up ---- */

  function readFragment() {
    const hash = location.hash;
    const fragment = hash.length > 1 ? input.parseFragment(hash) : null;
    if (hash.length > 0) history.replaceState(null, '', location.pathname + location.search);
    return fragment;
  }

  /* Applies the shared view from the fragment: input (text or hex), radix and the
   * compare field now, the position after the first computation. */
  function applyFragment(fragment) {
    if (!fragment) return;
    if (fragment.error) state.error = 'fragment';
    const value = fragment.m === 'x' ? fragment.hex : fragment.text;
    if (typeof value === 'string') {
      if (value.length > FRAGMENT_LIMIT) state.error = 'fragmentLimit';
      else {
        state.mode = fragment.m === 'x' ? 'hex' : 'text';
        if (state.mode === 'hex') state.hexText = value;
        else state.text = value;
      }
    }
    if (RADIXES.includes(fragment.r)) state.radix = fragment.r;
    if (typeof fragment.d === 'string' && fragment.d.length <= FRAGMENT_LIMIT) state.compare = fragment.d;
  }

  function applyFragmentPosition(fragment) {
    if (!fragment || typeof fragment.at !== 'string' || !state.result) return;
    const position = core.parsePositionId(fragment.at);
    if (!position) return;
    if (position.block !== null && position.block >= state.result.blocks) return;
    state.position = position;
    renderPosition(false);
  }

  function init() {
    const params = new URLSearchParams(location.search);
    const fragment = readFragment();
    language = pickLanguage([params.get('lang'), fragment ? fragment.l : null, readStorage(LANG_KEY)]);
    loadDisplay();
    applyDisplay();
    applyFragment(fragment);
    if (!(globalThis.crypto && globalThis.crypto.subtle) && !state.error) state.error = 'cryptoUnavailable';
    $('input-title').tabIndex = -1;
    for (const name of PANELS) $('board-' + name + '-title').tabIndex = -1;
    writeInputFields();
    $('compare-input').value = state.compare;
    localize();
    wireInput();
    wireStage();
    wireOutput();
    wireHeader();
    wireHelp();
    wireLayout();
    wireScroll();
    recompute();
    applyFragmentPosition(fragment);
    updateClockHeight();
  }

  perform(init);
}());
