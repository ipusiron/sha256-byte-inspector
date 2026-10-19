/* SHA-256 Byte Inspector - MIT (c) 2026 ipusiron
 * app.js wires the page to the pure modules: SHA256ByteInput (text and hex input),
 * SHA256ByteCore (hash and trace), SHA256ByteView (rendering models), SHA256BytePresets
 * and SHA256ByteMessages (wording). The state object is the single source of truth;
 * every render rebuilds elements with createElement and textContent and never writes
 * markup or inline styles. localStorage holds only the language and the display
 * settings; the URL fragment is read once at start-up and then cleared from the
 * address bar (the only write to the URL). Stage 1a-beta draws the still boards (the
 * reduced-motion view); band animation and autoplay arrive in stage 1b. */
(function () {
  'use strict';

  const core = window.SHA256ByteCore;
  const input = window.SHA256ByteInput;
  const presets = window.SHA256BytePresets;
  const view = window.SHA256ByteView;
  const messages = window.SHA256ByteMessages;
  const $ = id => document.getElementById(id);

  const TABS = ['guide', 'free', 'learn', 'settings'];
  const BOARDS = ['pad', 'split', 'schedule', 'round', 'final', 'digest'];
  const RAIL = ['input', 'pad', 'split', 'schedule', 'round', 'final', 'digest'];
  const RADIXES = ['hex', 'bin', 'dec'];
  const GRANULARITIES = ['step', 'eight', 'phase', 'block'];
  const COPY_IDS = ['copy-hash', 'copy-bytes-spaced', 'copy-bytes-joined', 'copy-sha256sum'];
  const LANG_KEY = 'sha256-byte-inspector.lang';
  const DISPLAY_KEY = 'sha256-byte-inspector.display';
  const BYTE_LIMIT = 65536;
  const FRAGMENT_LIMIT = 10000;
  const COLORED_LIMIT = 4096;
  const PER_ROW = 16;
  /* Bytes shown at each end of a long message segment on the padding board. */
  const PAD_EDGE_BYTES = 16;
  /* Characters shown on each side of the offending character of a hex error. */
  const ERROR_CONTEXT = 16;
  const ELLIPSIS = String.fromCharCode(0x2026);
  /* Milliseconds before the clock returns after a text area loses focus (see wireStage). */
  const CLOCK_RETURN_DELAY = 300;
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
    active: 'guide',
    granularity: 'step',
    theme: 'dark',
    motion: false,
    error: null
  };
  let language = 'en';
  let day117Cache = null;

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

  /* ---- language and display settings ---- */

  function pickLanguage(candidates) {
    const found = candidates.find(value => value === 'ja' || value === 'en');
    if (found) return found;
    return typeof navigator.language === 'string' && navigator.language.startsWith('ja') ? 'ja' : 'en';
  }

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
    const motion = saved && typeof saved === 'object' ? saved.motion : null;
    state.theme = theme === 'light' || theme === 'dark' ? theme : (matches('(prefers-color-scheme: light)') ? 'light' : 'dark');
    state.motion = typeof motion === 'boolean' ? motion : matches('(prefers-reduced-motion: reduce)');
  }

  function applyDisplay() {
    document.documentElement.dataset.theme = state.theme;
    if (state.motion) document.documentElement.dataset.motion = 'reduce';
    else delete document.documentElement.dataset.motion;
    $('theme-select').value = state.theme;
    $('motion-toggle').checked = state.motion;
  }

  function saveDisplay() {
    writeStorage(DISPLAY_KEY, JSON.stringify({ theme: state.theme, motion: state.motion }));
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
      renderPosition();
      renderDock();
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

  function positionText(model) {
    const m = model || positionModel();
    const label = t(m.labelKey, { t: m.index });
    if (m.blockNumber === null || m.phase === 'pad') return label;
    return t('rail.block', { n: m.blockNumber, total: m.blocks }) + ' ' + label;
  }

  function goToStep(k, announce) {
    if (!state.result) return;
    const clamped = Math.max(0, Math.min(totalSteps() - 1, k));
    state.position = core.stepAt(state.result.blocks, clamped);
    renderPosition();
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
        goToStep(k + 8 * direction, true);
        break;
      case 'phase':
        goToStep(nextStart(phaseStarts(), k, direction), true);
        break;
      case 'block':
        goToStep(nextStart(blockStarts(), k, direction), true);
        break;
      default:
        goToStep(k + direction, true);
    }
  }

  function jumpToPhase(phase) {
    if (phase === 'input') {
      const title = $('input-title');
      title.scrollIntoView({ block: 'start' });
      title.focus();
      return;
    }
    if (!state.result) return;
    const blocks = state.result.blocks;
    const block = state.position.block === null ? blocks - 1 : state.position.block;
    if (phase === 'pad') state.position = { phase: 'pad', block: 0, index: 0 };
    else if (phase === 'digest') state.position = { phase: 'digest', block: null, index: 0 };
    else state.position = { phase, block, index: phase === 'schedule' ? 16 : 0 };
    renderPosition();
    $('announcement').textContent = positionText();
    if (boardsVisible()) $('board-' + phase + '-title').focus();
  }

  /* ---- rendering: controls, errors, statistics, byte grid ---- */

  function syncControls() {
    const hex = state.mode === 'hex';
    $('input-mode-text').checked = !hex;
    $('input-mode-hex').checked = hex;
    $('text-field').hidden = hex;
    $('hex-field').hidden = !hex;
    $('newline-select').value = state.options.newline;
    $('trailing-newline').checked = state.options.trailingNewline;
    $('bom-check').checked = state.options.bom;
    $('newline-select').disabled = hex;
    $('trailing-newline').disabled = hex;
    $('bom-check').disabled = hex;
    $('preset-select').value = state.presetId || '';
    $('radix-select').value = state.radix;
    $('granularity').value = state.granularity;
  }

  function errorText(code) {
    switch (code) {
      case 'match':
        return t('dock.match.ng');
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

  function renderGrid() {
    const grid = $('byte-grid');
    const legend = $('byte-legend');
    grid.replaceChildren();
    legend.replaceChildren();
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
          if (!seen.has(cell.cls)) seen.set(cell.cls, cell.hex);
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
  }

  /* ---- rendering: stage rail, clock ---- */

  function renderRail() {
    const phase = state.result ? state.position.phase : null;
    for (const button of $('stage-rail').querySelectorAll('button')) {
      if (button.dataset.phase === phase) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
      button.disabled = button.dataset.phase !== 'input' && !state.result;
    }
    if (!state.result) {
      $('position-block').textContent = '';
      $('position-index').textContent = '';
      return;
    }
    const m = positionModel();
    $('position-block').textContent = m.blockNumber === null || m.phase === 'pad' ? '' : t('rail.block', { n: m.blockNumber, total: m.blocks });
    $('position-index').textContent = t(m.labelKey, { t: m.index });
  }

  function renderClock() {
    const range = $('clock-range');
    const has = state.result !== null;
    for (const id of ['clock-first', 'clock-prev', 'clock-next', 'clock-last']) $(id).disabled = !has;
    /* Autoplay and its speed arrive in stage 1b. */
    $('clock-play').disabled = true;
    $('clock-speed').disabled = true;
    range.disabled = !has;
    if (!has) {
      range.max = '0';
      range.value = '0';
      range.setAttribute('aria-valuetext', '');
      return;
    }
    const m = positionModel();
    range.max = String(m.total - 1);
    range.value = String(m.stepIndex);
    range.setAttribute('aria-valuetext', positionText(m));
  }

  function renderPosition() {
    renderRail();
    renderStage();
    renderClock();
    $('copy-worksheet').disabled = !(boardsVisible() && state.position.phase === 'round');
  }

  /* ---- rendering: boards ---- */

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

  function bitRow(bitList, decorate) {
    const row = node('div', undefined, 'bits');
    bitList.forEach((bit, i) => {
      const cell = node('span', String(bit), 'bit');
      if (bit === 1) cell.classList.add('is-one');
      if (decorate) decorate(cell, i, bit);
      row.append(cell);
    });
    return row;
  }

  function tile(text, label, className) {
    const element = node('span', undefined, 'tile' + (className ? ' ' + className : ''));
    if (label !== undefined) element.append(node('span', label, 'tile-label'));
    element.append(document.createTextNode(text));
    return element;
  }

  function tiles(items) {
    const row = node('div', undefined, 'tiles');
    for (const item of items) row.append(tile(item.text, item.label, item.className));
    return row;
  }

  function wordTiles(list, labels, resultNames) {
    return tiles(list.map((w, i) => ({
      text: wordText(w), label: labels[i], className: resultNames && resultNames.includes(labels[i]) ? 'is-result' : undefined
    })));
  }

  /* A 32-bit band: label and value on one line, the bits below (or beside, when wide). */
  function lane(label, w, role, decorate) {
    const element = node('div', undefined, 'lane' + (role ? ' ' + role : ''));
    const head = node('div', undefined, 'lane-head');
    head.append(node('span', label, 'lane-label'), tile(wordText(w)));
    element.append(head, bitRow(w.bits, decorate));
    return element;
  }

  function votesLane(label, votes) {
    const element = node('div', undefined, 'lane role2');
    const head = node('div', undefined, 'lane-head');
    head.append(node('span', label, 'lane-label'));
    const row = node('div', undefined, 'bits');
    for (const vote of votes) {
      const cell = node('span', String(vote), 'bit');
      if (vote >= 2) cell.classList.add('is-one');
      row.append(cell);
    }
    element.append(head, row);
    return element;
  }

  function sumRow(label, value, className) {
    const row = node('div', undefined, 'sum-row' + (className ? ' ' + className : ''));
    row.append(node('span', label), node('span', value));
    return row;
  }

  /* Terms, raw sum, dropped carries and the result mod 2^32, stacked. */
  function sumBlock(terms, s) {
    const block = node('div', undefined, 'sum');
    for (const [label, w] of terms) block.append(sumRow(label, wordText(w)));
    block.append(sumRow(t('board.raw'), rawText(s)));
    block.append(sumRow(t('board.dropped', { n: s.dropped }), s.dropped > 0 ? t('board.overflow') : '', 'sum-dropped'));
    block.append(sumRow(t('board.out'), wordText(s.out), 'is-result'));
    return block;
  }

  function note(text) {
    return node('p', text, 'board-note');
  }

  function segmentLabel(segment, model) {
    switch (segment.kind) {
      case 'message':
        return t('board.pad.message');
      case 'one':
        return t('board.pad.one');
      case 'zeros':
        return t('board.pad.zeros', { count: formatNumber(segment.count) });
      default:
        return t('board.pad.length', { bits: formatNumber(model.bitLen) });
    }
  }

  function segmentHex(segment, result) {
    if (segment.kind === 'message') {
      if (segment.count === 0) return '';
      if (segment.count <= PAD_EDGE_BYTES * 2) return segment.hex;
      const bytes = result.bytes;
      return core.hexBytes(bytes.subarray(0, PAD_EDGE_BYTES), ' ') + ' ' + ELLIPSIS + ' ' +
        core.hexBytes(bytes.subarray(bytes.length - PAD_EDGE_BYTES), ' ');
    }
    if (segment.kind === 'zeros' && segment.count > 4) return '00 00 ' + ELLIPSIS + ' 00 00';
    return segment.hex;
  }

  function renderPad(result) {
    const m = view.paddingModel(result);
    const segments = node('div', undefined, 'padding-segments');
    for (const segment of m.segments) {
      const element = node('span', undefined, 'segment is-' + segment.kind);
      element.append(node('span', segmentLabel(segment, m), 'tile-label'), document.createTextNode(segmentHex(segment, result)));
      segments.append(element);
    }
    return [segments, note(t('board.pad.blocks', { n: m.blocks })), note(t('board.pad.boundary'))];
  }

  function renderSplit(trace) {
    const m = view.blockModel(trace);
    const block = node('div', undefined, 'sum');
    for (const row of m.rows) {
      const line = node('div', undefined, 'sum-row');
      line.append(node('span', 'W[' + row.t + ']'), node('span', row.bytes.join(' ')), node('span', wordText(row.word)));
      block.append(line);
    }
    return [note(t('board.split.word')), block];
  }

  function renderSchedule(trace, index) {
    const m = view.scheduleModel(trace, index);
    $('board-schedule-title').textContent = t('board.schedule.title', { t: index });
    const refs = m.refs;
    const refLabel = ref => 'W[' + ref.index + ']';
    const out = [
      note(t('board.schedule.fromBlock')),
      node('h4', t('board.schedule.refs')),
      tiles([refs.t16, refs.t15, refs.t7, refs.t2].map(ref => ({ text: wordText(ref.word), label: refLabel(ref), className: 'is-ref' }))),
      node('h4', t('board.schedule.sigma0') + '(' + refLabel(refs.t15) + ')'),
      lane(refLabel(refs.t15), m.s0.x),
      lane(t('board.schedule.rotr', { n: 7 }), m.s0.rotr7, 'role2'),
      lane(t('board.schedule.rotr', { n: 18 }), m.s0.rotr18, 'role2'),
      lane(t('board.schedule.shr', { n: 3 }), m.s0.shr3, 'role3'),
      lane(t('board.schedule.sigma0'), m.s0.out, 'role4'),
      node('h4', t('board.schedule.sigma1') + '(' + refLabel(refs.t2) + ')'),
      lane(refLabel(refs.t2), m.s1.x),
      lane(t('board.schedule.rotr', { n: 17 }), m.s1.rotr17, 'role2'),
      lane(t('board.schedule.rotr', { n: 19 }), m.s1.rotr19, 'role2'),
      lane(t('board.schedule.shr', { n: 10 }), m.s1.shr10, 'role3'),
      lane(t('board.schedule.sigma1'), m.s1.out, 'role4'),
      node('h4', t('board.schedule.sum')),
      sumBlock([
        [refLabel(refs.t16), m.sum.terms[0]],
        [t('board.schedule.sigma0'), m.sum.terms[1]],
        [refLabel(refs.t7), m.sum.terms[2]],
        [t('board.schedule.sigma1'), m.sum.terms[3]]
      ], m.sum),
      lane('W[' + index + ']', m.sum.out, 'role4')
    ];
    return out;
  }

  function renderRound(trace, index) {
    const m = view.roundModel(trace, index);
    $('board-round-title').textContent = t('board.round.title', { t: index });
    const names = view.REGISTERS;
    const chooseF = (cell, i) => { if (m.ch.select[i] === 1) cell.classList.add('is-source'); };
    const chooseG = (cell, i) => { if (m.ch.select[i] === 0) cell.classList.add('is-source'); };
    return [
      node('h4', t('board.round.before')),
      wordTiles(m.before, names),
      tiles([
        { text: wordText(m.K), label: t('board.round.K'), className: 'is-ref' },
        { text: wordText(m.W), label: t('board.round.W'), className: 'is-ref' }
      ]),
      node('h4', t('board.round.S1')),
      lane('e', m.S1.x),
      lane(t('board.schedule.rotr', { n: 6 }), m.S1.rotr6, 'role2'),
      lane(t('board.schedule.rotr', { n: 11 }), m.S1.rotr11, 'role2'),
      lane(t('board.schedule.rotr', { n: 25 }), m.S1.rotr25, 'role2'),
      lane(t('board.round.S1'), m.S1.out, 'role4'),
      node('h4', t('board.round.ch')),
      lane('e', m.ch.e),
      lane('f', m.ch.f, 'role2', chooseF),
      lane('g', m.ch.g, 'role3', chooseG),
      lane(t('board.round.ch'), m.ch.out, 'role4'),
      node('h4', t('board.round.S0')),
      lane('a', m.S0.x),
      lane(t('board.schedule.rotr', { n: 2 }), m.S0.rotr2, 'role2'),
      lane(t('board.schedule.rotr', { n: 13 }), m.S0.rotr13, 'role2'),
      lane(t('board.schedule.rotr', { n: 22 }), m.S0.rotr22, 'role2'),
      lane(t('board.round.S0'), m.S0.out, 'role4'),
      node('h4', t('board.round.maj')),
      lane('a', m.maj.a),
      lane('b', m.maj.b, 'role2'),
      lane('c', m.maj.c, 'role3'),
      votesLane('a+b+c', m.maj.votes),
      lane(t('board.round.maj'), m.maj.out, 'role4'),
      node('h4', t('board.round.T1')),
      sumBlock([
        ['h', m.T1.terms[0]],
        [t('board.round.S1'), m.T1.terms[1]],
        [t('board.round.ch'), m.T1.terms[2]],
        [t('board.round.K'), m.T1.terms[3]],
        [t('board.round.W'), m.T1.terms[4]]
      ], m.T1),
      node('h4', t('board.round.T2')),
      sumBlock([
        [t('board.round.S0'), m.T2.terms[0]],
        [t('board.round.maj'), m.T2.terms[1]]
      ], m.T2),
      node('h4', t('board.round.newE')),
      sumBlock([['d', m.e.d], ['T1', m.e.T1]], m.e),
      node('h4', t('board.round.newA')),
      sumBlock([['T1', m.a.T1], ['T2', m.a.T2]], m.a),
      node('h4', t('board.round.after')),
      wordTiles(m.after, names, m.newly),
      note(t('board.round.newly'))
    ];
  }

  function renderFinal(trace) {
    const m = view.finalModel(trace);
    const out = [];
    for (const item of m.lanes) {
      out.push(sumBlock([[t('board.final.lane', { i: item.i }), item.h], [view.REGISTERS[item.i], item.v]], item));
    }
    out.push(tiles(m.Hout.map((w, i) => ({ text: wordText(w), label: t('board.final.lane', { i }), className: 'is-result' }))));
    return out;
  }

  function renderDigest(result) {
    const m = view.digestModel(result);
    return [
      tiles(m.groups.map((group, i) => ({ text: group, label: t('board.final.lane', { i }), className: 'is-result' }))),
      node('code', m.hex64),
      note(t('board.digest.concat'))
    ];
  }

  function renderStage() {
    const show = boardsVisible();
    const phase = state.position.phase;
    for (const name of BOARDS) {
      const board = $('board-' + name);
      board.hidden = !show || name !== phase;
      if (board.hidden) board.querySelector('.board-body').replaceChildren();
    }
    if (!show) return;
    const body = $('board-' + phase).querySelector('.board-body');
    const result = state.result;
    const block = state.position.block;
    let content;
    switch (phase) {
      case 'pad':
        content = renderPad(result);
        break;
      case 'split':
        content = renderSplit(traceFor(block));
        break;
      case 'schedule':
        content = renderSchedule(traceFor(block), state.position.index);
        break;
      case 'round':
        content = renderRound(traceFor(block), state.position.index);
        break;
      case 'final':
        content = renderFinal(traceFor(block));
        break;
      default:
        content = renderDigest(result);
    }
    body.replaceChildren(...content);
  }

  /* ---- rendering: instrument dock ---- */

  function renderDock() {
    const badge = $('match-badge');
    const has = state.result !== null;
    badge.dataset.state = has ? state.cryptoStatus : 'unknown';
    badge.textContent = has ? t('dock.match.' + state.cryptoStatus) : '';
    const groups = $('digest-groups');
    groups.replaceChildren();
    $('dropped-stats').textContent = '';
    const ok = boardsVisible();
    for (const id of COPY_IDS) $(id).disabled = !ok;
    $('copy-worksheet').disabled = !(ok && state.position.phase === 'round');
    if (ok) {
      for (const group of view.digestModel(state.result).groups) groups.append(node('span', group));
      const d = view.droppedStats(state.result, state.traces);
      $('dropped-stats').textContent = t('dock.dropped', {
        s: d.schedule.count, st: d.schedule.total, t: d.t1.count, tt: d.t1.total, f: d.final.count, ft: d.final.total, m: d.max
      });
    }
    renderCompare();
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

  function fallbackArea() {
    let area = $('copy-fallback');
    if (!area) {
      area = node('textarea');
      area.id = 'copy-fallback';
      area.readOnly = true;
      area.rows = 3;
      area.spellcheck = false;
      area.setAttribute('aria-label', t('dock.copy'));
      $('dock').querySelector('.dock-actions').after(area);
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

  /* ---- whole page ---- */

  function render() {
    syncControls();
    renderError();
    renderInputError();
    renderStats();
    renderGrid();
    renderPosition();
    renderDock();
  }

  function localize() {
    document.documentElement.lang = language;
    document.title = t('title');
    document.querySelectorAll('[data-i18n]').forEach(element => {
      element.textContent = t(element.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-label]').forEach(element => {
      element.setAttribute('aria-label', t(element.dataset.i18nLabel));
    });
    $('lang-toggle').setAttribute('lang', language === 'ja' ? 'en' : 'ja');
    $('compare-input').placeholder = t('compare.placeholder');
    const area = $('copy-fallback');
    if (area) area.setAttribute('aria-label', t('dock.copy'));
    renderPresetOptions();
  }

  function showTab(name) {
    state.active = name;
    for (const tab of TABS) {
      const button = $('tab-' + tab);
      button.setAttribute('aria-selected', String(tab === name));
      button.tabIndex = tab === name ? 0 : -1;
      $('panel-' + tab).hidden = tab !== name;
    }
  }

  /* ---- events ---- */

  function wireTabs() {
    for (const tab of TABS) {
      const button = $('tab-' + tab);
      button.addEventListener('click', () => showTab(tab));
      button.addEventListener('keydown', event => {
        const index = TABS.indexOf(tab);
        const next = TABS[(index + 1) % TABS.length];
        const previous = TABS[(index + TABS.length - 1) % TABS.length];
        const target = {
          ArrowRight: next, ArrowDown: next, ArrowLeft: previous, ArrowUp: previous, Home: TABS[0], End: TABS[TABS.length - 1]
        }[event.key];
        if (target) {
          event.preventDefault();
          showTab(target);
          $('tab-' + target).focus();
        }
      });
    }
  }

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
      recompute();
    };
    const onHex = event => {
      if (event && event.isComposing) return;
      state.hexText = hexInput.value;
      userEdited();
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
    $('clock-first').addEventListener('click', () => goToStep(0, true));
    $('clock-last').addEventListener('click', () => { if (state.result) goToStep(totalSteps() - 1, true); });
    $('clock-prev').addEventListener('click', () => move(-1));
    $('clock-next').addEventListener('click', () => move(1));
    $('clock-range').addEventListener('input', () => goToStep(Number($('clock-range').value), true));
    $('granularity').addEventListener('change', () => {
      const value = $('granularity').value;
      state.granularity = GRANULARITIES.includes(value) ? value : 'step';
    });
    $('radix-select').addEventListener('change', () => {
      const value = $('radix-select').value;
      state.radix = RADIXES.includes(value) ? value : 'hex';
      renderStage();
    });
    document.addEventListener('keydown', event => {
      if (event.defaultPrevented || state.active !== 'free' || !state.result) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      const tag = target && target.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      let handled = true;
      switch (event.key) {
        case 'ArrowRight':
          goToStep(stepIndex() + (event.shiftKey ? 8 : 1), true);
          break;
        case 'ArrowLeft':
          goToStep(stepIndex() - (event.shiftKey ? 8 : 1), true);
          break;
        case 'PageDown':
          goToStep(nextStart(phaseStarts(), stepIndex(), 1), true);
          break;
        case 'PageUp':
          goToStep(nextStart(phaseStarts(), stepIndex(), -1), true);
          break;
        case 'Home':
          goToStep(0, true);
          break;
        case 'End':
          goToStep(totalSteps() - 1, true);
          break;
        default:
          if (/^[1-7]$/.test(event.key)) jumpToPhase(RAIL[Number(event.key) - 1]);
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

  function wireDock() {
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

  function wireSettings() {
    $('lang-toggle').addEventListener('click', () => {
      language = language === 'ja' ? 'en' : 'ja';
      writeStorage(LANG_KEY, language);
      localize();
      render();
    });
    $('theme-select').addEventListener('change', () => {
      state.theme = $('theme-select').value === 'light' ? 'light' : 'dark';
      applyDisplay();
      saveDisplay();
    });
    $('motion-toggle').addEventListener('change', () => {
      state.motion = $('motion-toggle').checked;
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
    if (!fragment) return false;
    if (fragment.error) state.error = 'fragment';
    const value = fragment.m === 'x' ? fragment.hex : fragment.text;
    let accepted = false;
    if (typeof value === 'string') {
      if (value.length > FRAGMENT_LIMIT) state.error = 'fragmentLimit';
      else {
        state.mode = fragment.m === 'x' ? 'hex' : 'text';
        if (state.mode === 'hex') state.hexText = value;
        else state.text = value;
        accepted = true;
      }
    }
    if (RADIXES.includes(fragment.r)) state.radix = fragment.r;
    if (typeof fragment.d === 'string' && fragment.d.length <= FRAGMENT_LIMIT) state.compare = fragment.d;
    return accepted;
  }

  function applyFragmentPosition(fragment) {
    if (!fragment || typeof fragment.at !== 'string' || !state.result) return;
    const position = core.parsePositionId(fragment.at);
    if (!position) return;
    if (position.block !== null && position.block >= state.result.blocks) return;
    state.position = position;
    renderPosition();
  }

  function init() {
    const params = new URLSearchParams(location.search);
    const fragment = readFragment();
    language = pickLanguage([params.get('lang'), fragment ? fragment.l : null, readStorage(LANG_KEY)]);
    loadDisplay();
    applyDisplay();
    const accepted = applyFragment(fragment);
    if (!(globalThis.crypto && globalThis.crypto.subtle) && !state.error) state.error = 'cryptoUnavailable';
    $('input-title').tabIndex = -1;
    for (const name of BOARDS) $('board-' + name + '-title').tabIndex = -1;
    writeInputFields();
    $('compare-input').value = state.compare;
    localize();
    wireTabs();
    wireInput();
    wireStage();
    wireDock();
    wireSettings();
    showTab(accepted ? 'free' : 'guide');
    recompute();
    applyFragmentPosition(fragment);
  }

  perform(init);
}());
