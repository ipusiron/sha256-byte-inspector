# SHA-256 Byte Inspectorの開発

このリポジトリーは、SHA-256に渡すバイト列を隠さず見せ、パディングから64ラウンドまでの計算の中身を段階ごとに追えるDay118の教材です。画面に出す値はすべて実際の計算から求め、表示用の固定値を埋め込みません。

## 構成

- `sha256-core.js`：DOMに依存しないUMD。`SHA256ByteCore`を公開。純JSのSHA-256（トレース付き）、パディング、定数の導出、歩のモデル、差分
- `input-core.js`：DOMに依存しないUMD。`SHA256ByteInput`を公開。文字列のUTF-8化と改行・BOMの扱い、16進の読み取り、文字の分類、URLフラグメントの読み書き
- `trace-view.js`：DOMに依存しないUMD。`SHA256ByteView`を公開。トレースと位置から描画モデルを作る純関数
- `presets.js`：言語に依存しない入力のプリセット（`SHA256BytePresets`）。落とし穴の実験の対照ペア、NISTの例題、Day117の再現例。文言は辞書の`preset.<id>`。非ASCIIはエスケープで書く。Day117の例は起点のハッシュを埋め込まず、`day117.build(digestHexOf)`で計算して組み立てる
- `messages.js`：静的・動的な文言の日英辞書
- `app.js`：4つの入口、入力カード、ステージ、計器ドック、時計、DOM構築
- `learning-progress.js`：理解チェックの保存（段階1cで追加）
- `style.css`：幅320px以上、44px以上の操作要素、製図の意匠、明暗の配色トークン
- `test/`：既知解答（FIPS 180-4・NIST・CAVP・RFC 6234・Day117）、不変条件、Web Cryptoとの一致、16進と文字列の規則、HTML、辞書、配色、README
- `test/vectors/`：公式のテストベクトルの原本と、そこから機械的に抽出したJSON
- `test/tools/`：抽出スクリプト。期待値は手で書かず、このスクリプトで原本から作る
- `.github/workflows/test.yml`：Node 22の構文検査とテスト

## コマンド

依存パッケージはありません。Node 22以上で実行します。

```sh
npm test
node --check sha256-core.js
node --check input-core.js
node --check app.js
```

変更したすべてのJavaScriptに`node --check`を実行します。`index.html`はfile://、ローカルHTTP、公開HTTPSで確認します。

## 計算の規則（FIPS 180-4）

- パディング（5.1.1）：メッセージの直後に`0x80`、全長が56 mod 64バイトになるまで`0x00`、最後に元の長さ（ビット）を64ビットのビッグエンディアンで置く。ブロック数はfloor((n+8)/64)+1。55バイトは1ブロック、56バイトは2ブロック
- ブロック分割（5.2.1）：64バイトを16個の32ビット語にビッグエンディアンで束ねる
- メッセージスケジュール（6.2.2）：W[t]＝σ1(W[t−2])＋W[t−7]＋σ0(W[t−15])＋W[t−16]（t＝16〜63、mod 2^32）
- ラウンド（6.2.2）：T1＝h＋Σ1(e)＋Ch(e,f,g)＋K[t]＋W[t]、T2＝Σ0(a)＋Maj(a,b,c)、h←g、g←f、f←e、e←d＋T1、d←c、c←b、b←a、a←T1＋T2
- 最終加算（6.2.2）：H[i]←H[i]＋作業変数。複数ブロックでは前のブロックの出力が次の初期値になる
- 初期値H0〜H7は最初の8個の素数の平方根の小数部の先頭32ビット、K0〜K63は最初の64個の素数の立方根の小数部の先頭32ビット（4.2.2・5.3.3）。回転量の由来は標準に記述がなく、画面でも「標準は値のみ定める」と書く
- 最終値は`crypto.subtle.digest('SHA-256', …)`と一致することをテストで縛り、画面でも毎回比べる。Web Cryptoが使えない環境では純JSの値だけを「未確認」として表示する

## モジュールのAPI

数値はすべて符号なし32ビット（`>>> 0`）で持ちます。和の「生の値」はNumber（2^53未満）で持ち、`dropped`＝floor(raw ÷ 2^32)が捨てた桁です。16進は小文字です。

### `SHA256ByteCore`

- `K`（Uint32Array 64）、`H0`（Uint32Array 8）
- `deriveConstants()`→`{H: string[8], K: string[64], primes: number[64]}`。BigIntの整数平方根・立方根から小数部の先頭32ビットを求める。表を引かない
- `derivation(prime, kind)`→`{prime, kind: 'sqrt' | 'cbrt', root: string, integer: string, decimal: string, fraction: string}`。`root`はBigIntの整数根＝floor(p^(1/k)×2^32)の10進（√2なら`6074000999`）、`integer`は整数部の10進（√2なら`1`）、`decimal`は小数部20桁の10進展開、`fraction`は先頭32ビットの16進（`root`の下位32ビット）。画面の「定数の導出」で使う
- `rotr(x, n)`、`shr(x, n)`、`sigma0(x)`、`sigma1(x)`、`Sigma0(x)`、`Sigma1(x)`、`ch(x, y, z)`、`maj(x, y, z)`、`add32(...xs)`→`{raw, dropped, out}`
- `pad(bytes)`→`{padded: Uint8Array, layout: {messageEnd, oneBit, zeroStart, zeroEnd, lengthStart, bitLen, bitLenHi, bitLenLo, blocks}}`
- `hash(bytes)`→`{bytes, padded, layout, blocks, Hin: Uint32Array(8×(blocks+1)), digest: Uint8Array(32), digestHex}`。`Hin`の先頭8語はH0、末尾8語はダイジェスト
- `compress(Hin, block, offset)`→Uint32Array(8)。1ブロックの圧縮だけを行う純関数（巨大入力をブロックごとに検算するテストで使う）。`blockCount(length)`→ブロック数
- `traceBlock(result, b)`→1ブロックのトレース。圧縮は(Hin, block)の純関数なので、見ているブロックだけを後から再現できる。`rounds[t].before`はラウンドt−1の`after`と同じ配列（書き換えない）
  - `index`、`block`（Uint8Array 64）、`words`（Uint32Array 16）、`W`（Uint32Array 64）、`Hin`（Uint32Array 8）、`Hout`（Uint32Array 8）
  - `schedule[48]`：`{t, x15, x2, s0: {rotr7, rotr18, shr3, out}, s1: {rotr17, rotr19, shr10, out}, terms: [W16, s0, W7, s1], raw, dropped, out}`
  - `rounds[64]`：`{t, K, W, before: Uint32Array(8), S1: {rotr6, rotr11, rotr25, out}, ch, S0: {rotr2, rotr13, rotr22, out}, maj, T1: {terms: [h, S1, ch, K, W], raw, dropped, out}, T2: {terms: [S0, maj], raw, dropped, out}, e: {raw, dropped, out}, a: {raw, dropped, out}, after: Uint32Array(8)}`
  - `final[8]`：`{i, h, v, raw, dropped, out}`
- 歩のモデル：`stepCount(blocks)`＝1＋blocks×(1＋48＋64＋1)＋1（1ブロックで116、2ブロックで230、16ブロックで1826）。`stepAt(blocks, k)`→`{phase, block, index}`。phaseは`pad`（k＝0、`block: 0`）、`split`、`schedule`（index 16〜63）、`round`（0〜63）、`final`、`digest`（最後。`block: null`）。範囲外は`RangeError`。`stepOf(blocks, position)`は逆。`positionId(position)`→`b1.pad`、`b1.split`、`b1.w16`、`b1.r51`、`b1.add`、`out`。`parsePositionId(id)`は逆で、不正な文字列（`b1.r05`や`b1.w15`のような非正規形を含む）には`null`を返す
- `popcount(x)`、`diffWords(a, b)`、`diffBytes(a, b)`（違うバイトの位置の配列。長さの差も違いとして数える）、`diffTrace(traceA, traceB)`→`{W: number[64], rounds: number[64], final: number}`（各ラウンドは`after`の8語256ビットの差）
- `hexBytes(bytes, separator)`、`hexWord(x)`（8桁）、`bin32(x)`（32桁）

### `SHA256ByteInput`

- `encodeText(text, {newline: 'lf' | 'crlf', trailingNewline: boolean, bom: boolean})`→`{text, bytes, stats, chars}`
  - `newline`が`crlf`のときは、CRの直後でないLFをCRLFにする。`lf`のときは文字列をそのまま使う（textareaから来る文字列は改行がLFに正規化されている）
  - `trailingNewline`が真なら、末尾に改行を1つ付ける（元の末尾が改行でも付ける）。`bom`が真なら先頭にU+FEFFを付ける
  - `stats`：`{codePoints, utf16Units, byteCount, lf, cr, crlf, trailingNewline: 'none' | 'lf' | 'crlf', loneSurrogates, bom, normalization: 'nfc' | 'nfd' | 'both' | 'neither'}`。`lf`は単独のLF、`crlf`は組、`cr`は単独のCRの数
  - `chars`：コードポイントごとに`{index, cp, char, start, length, cls}`。`start`と`length`はバイト列の位置。孤立サロゲートはencodeの前に検出し、`cls`を`lone-surrogate`にする（バイト列はU+FFFDの3バイト）
  - `cls`：`text`、`lf`、`cr`、`tab`、`space`、`nbsp`、`ideographic-space`、`zwsp`、`zwj`、`vs16`、`bom`、`replacement`、`lone-surrogate`、`control`、`format`
- `parseHex(text)`→成功は`{ok: true, bytes, normalized, tokens: [{start, end, raw, prefix, hex, count}], removed: {prefix0x, prefixBackslashX, separators, whitespace, uppercase}, warnings}`、失敗は`{ok: false, error: {code: 'odd-length' | 'invalid-char', position, line, column, char, codePoint, name, token, tokenStart}, warnings}`（失敗時も`dump-like`の警告を付ける。奇数長の`position`は対のない最後の桁を指す）
  - 区切りはASCII空白（SP・TAB・LF・CR・VT・FF）と`,` `:` `-` `;` `{` `}` `[` `]`。各トークンの先頭の`0x`・`0X`を1回だけ剥がす。`\x`は接頭辞であり区切りでもある（`\x7b\x7b`は`7b 7b`。`\`は16進の桁になり得ないので曖昧さがない。CyberChefのFrom Hexと同じ読み）。残りは16進だけで偶数長。`7b7b`のような連続列も1トークン
  - 奇数長のトークン、16進以外の文字（全角数字、U+3000、U+00A0、U+FEFF、途中の`0x`）はエラー。空白をまたいだ結合も、余り1文字の補完もしない。`normalized`は小文字2桁・空白区切り
  - `warnings`：行頭がオフセットらしい（`0000000:`など）とき`dump-like`、トークンが64桁の16進1つだけのとき`hash-like`
  - 空入力は0バイトで成功
- `classifyCodePoint(cp)`→`cls`（Ccは`control`、Cfは`format`、名前のない空白類は`space`、ほかは`text`）。`CLASSES`は15分類の配列で、辞書の`cls.*`はこれと同じ集合にする。`unicodeName(cp)`→`U+3000 IDEOGRAPHIC SPACE`のような文字列（主な不可視文字は名前つき、ほかは`U+XXXX`）。`hexBytes(bytes)`→小文字2桁・空白区切り
- `normalizationStatus(text)`→`nfc`、`nfd`、`both`、`neither`
- `parseFragment(hash)`→`{v, text, hex, at, r, l, m, d, error}`（欠けた値は`null`。`decodeURIComponent`の失敗は`error: true`にして空。`m`は`'t'`／`'x'`／`null`、`in`は`m`が`'x'`なら`hex`へ、それ以外は`text`へ。Day117型の`text=`／`hex=`も受ける。`FRAGMENT_KEYS`はキーの一覧）。`buildFragment(params)`→`{fragment: '#v=1&…', error, omitted}`（`toString()`は`fragment`を返す。長さの判定は`fragment.length`で行う。`encodeURIComponent`が投げた値は省いて`omitted`に入れ`error: true`）。`+`は空白にしない
- `sha256sumLine(digestHex)`→`<64桁>  -`の形

## テストと期待値

期待値を手で書きません。すべて次の原本から抽出スクリプトで作るか、参照実装（`node:crypto`）から生成します。

- `test/vectors/nist-sha256-examples.txt`：NIST「SHA-256 Examples with Intermediate Values」をテキスト化したもの。`test/tools/extract-nist-examples.js`で`nist-sha256-rounds.json`を作る（"abc"と56バイトの例。各ブロックのW[0..15]と、t＝0〜63のa〜h、ダイジェスト）
- `test/vectors/sha2-additional.txt`：NIST「SHA-2 Additional Test Data」。`extract-sha2-additional.js`でSHA-256の13件を`sha2-additional-sha256.json`に。巨大な3件は`SHA256_SLOW=1`のときだけ実行
- `test/vectors/nist-cavp/`：CAVPの`SHA256ShortMsg.rsp`・`SHA256LongMsg.rsp`・`SHA256Monte.rsp`。zip全体のSHA-256は`929ef80b7b3418aca026643f6f248815913b60e01741a44bba9e118067f4c9b8`。`test/tools/rsp.js`で読む。Len＝0の行は空入力
- `test/vectors/rfc6234.txt`：RFC 6234の本文。`extract-rfc6234.js`で8.5のバイト指向7件（TEST1〜4・6・8・10）を`rfc6234-sha256.json`に
- `test/vectors/day117-chain-vectors.json`：Day117 Hash Chain Tamper Trainerの既知解答。起点はヘッダーをLFでつないだ文字列のSHA-256、各行は「前のハッシュ|項目をカンマでつないだもの」
- 不変条件：W[t]の再計算、ラウンドの漸化、Hout＝Hin＋状態、次のブロックのHin＝前のHout、dropped＝floor(raw ÷ 2^32)
- 乱数の入力200件で純JSと`globalThis.crypto.subtle.digest`が一致すること

JSON形式

- `nist-sha256-rounds.json`：`{"samples": [{"name", "input", "inputHex", "digest", "blocks": [{"Hin": [8], "W": [16], "rounds": [{"t", "state": [8]}], "Hout": [8]}]}]}`（原本にW[16..63]の印字はないので、スケジュールは再計算の一致で検査する）
- `day117-inputs.json`：`[{"name", "input", "expected"}]`（`extract-day117-inputs.js`が同梱の`day117-chain-vectors.json`から組む）
- 抽出スクリプトは`node --test`の配下（`NODE_TEST_CONTEXT`あり）では検査モードで動く＝原本から再抽出して同梱のJSONと比べ、違えば落ちる。原本や抽出スクリプトを変えたら`node test/tools/<script>.js`でJSONを作り直す
- `sha2-additional-sha256.json`：`[{"n", "description", "input": {"hex"} | {"fill", "count"}, "digest"}]`
- `rfc6234-sha256.json`：`[{"n", "name", "inputHex", "repeat", "digest"}]`

NISTの成果物は米国政府の著作物として米国内では著作権の対象外で、配布物に次の文を含めます。This data/work was created by employees of the National Institute of Standards and Technology (NIST), an agency of the Federal Government. Pursuant to title 17 United States Code Section 105, works of NIST employees are not subject to copyright protection in the United States. This data/work may be subject to foreign copyright.

## 表示・安全・検証

本文はですます調、箇条書きと表はである調にします。日英の文言は辞書にそろえ、JavaScriptに日本語を書きません。言語の変更は描画だけで、入力・計算結果・位置を保持します。

DOMは`createElement`と`textContent`で組み立てます。CSPは`connect-src 'none'`を含む許可制です。通信API、Worker、外部フォント、CDN、依存パッケージ、ES moduleを追加しません。

動きはCSSOMの`transform`・`opacity`とSVGの属性・classだけで書きます。`setAttribute('style', …)`、動的な`<style>`、`insertRule`、`innerHTML`は使いません。`prefers-reduced-motion`では前後の静止2段に置き換えます。

入力・ハッシュ・位置を保存しません。localStorageは言語の`sha256-byte-inspector.lang`、表示設定の`sha256-byte-inspector.display`、理解チェックの`sha256-byte-inspector.learning`だけを使います。URLへの書き込みは、読み込んだ`#`を消す`history.replaceState`の1か所だけです。

改ざんの検知・整合性の検証・原像の計算を名乗りません。「同じバイト列なら同じハッシュになることを確かめる」「計算し直して値を比べる」「手で検算する」の形で書きます。純JSのSHA-256は教材のためのもので、本番の用途には`crypto.subtle`を使うことを明記します。

### `SHA256ByteView`（描画モデル。DOMを触らない純関数）

ビットは配列で持ちます。`bits(x)`→`number[32]`（先頭がビット31＝MSB）。語は`{hex, bin, dec, bits}`の形にそろえます（`word(x)`）。

- `byteGrid(bytes, chars, {perRow: 16, coloredLimit: 4096})`→`{rows: [{offset, cells: [{index, hex, cls, charIndex}]}], truncated, plainRows: string[]}`。`cls`は`chars`から引く（16進モードでは`text`）。`coloredLimit`を超えた分は`plainRows`（1行16バイトの文字列）に入れる
- `paddingModel(result)`→`{segments: [{kind: 'message' | 'one' | 'zeros' | 'length', start, end, hex}], bitLen, blocks, boundary: {bytes, isTwoBlocks}}`。`zeros`の`hex`は先頭2バイトと末尾2バイトだけで、`count`を添える
- `blockModel(trace)`→`{rows: [{t, word, bytes: [4]}]}`（16行）
- `scheduleModel(trace, t)`→`{t, refs: {t16, t15, t7, t2}（各`{index, word}`）, s0: {x, rotr7, rotr18, shr3, out}（各`word`）, s1: {…}, sum: {terms: [word×4], raw, dropped, out}}`。t<16のときは`{t, source: 'block', word}`
- `roundModel(trace, t)`→`{t, K, W, before: [word×8], S1: {x, rotr6, rotr11, rotr25, out}, ch: {e, f, g, out, select: number[32]（1なら f、0なら g）}, S0: {…}, maj: {a, b, c, out, votes: number[32]}, T1: {terms: [word×5], raw, dropped, out}, T2: {…}, e: {d, T1, raw, dropped, out}, a: {T1, T2, raw, dropped, out}, after: [word×8], newly: ['a', 'e']}`
- `finalModel(trace)`→`{lanes: [{i, h, v, raw, dropped, out}（各`word`）], Hout: [word×8]}`
- `digestModel(result)`→`{words: [8], hex64, groups: string[8]（8桁ずつ）, bytes: 32}`
- `positionModel(result, position)`→`{phase, block, index, id, stepIndex, total, labelKey}`。時計とレールが使う
- `droppedStats(result)`→`{schedule: {count, total}, t1: {count, total}, final: {count, total}, max}`（全ブロックの合計）
- `worksheet(result, trace, t, {lang})`→テキスト（1ラウンド分。before・各項目のhexと10進・生の和・捨てた桁・after）。`worksheetAll(result, trace)`→64ラウンド分
- `copyFormats(result)`→`{hex64, bytesSpaced, bytesJoined, sha256sum}`。すべて状態の値から作り、DOMの文字は使わない
- `compareDigest(text, digestHex)`→`{found: string[]（64桁の候補）, match: boolean | null, normalized}`。貼られた文字列から64桁の16進をすべて抜き出し、小文字化して比べる。候補が2つ以上なら`match`は`null`で画面が選ばせる
- `diffModel(traceA, traceB, position)`（段階1c）

### 画面（index.html）の約束

- 入口＝`nav.entries`に`tab-guide`・`tab-free`・`tab-learn`・`tab-settings`（`role="tab"`、`aria-controls="panel-…"`）。最初に開くのは`guide`。段階1a-βでは`guide`と`learn`は見出しと短い案内だけ
- 入力カード（`panel-free`の先頭）＝モードの切り替え`input-mode`（`text`／`hex`のラジオ）、`text-input`と`hex-input`（どちらもtextarea）、`newline-select`（lf／crlf）、`trailing-newline`、`bom-check`、`preset-select`（落とし穴の実験とDay117の再現例）、`input-stats`（3つの数と改行・BOM・正規化の札）、`input-error`（`role="alert"`）、`byte-grid`と`byte-legend`
- 段階レール`stage-rail`＝7つのボタン（`data-phase`）。現在位置に`aria-current="step"`。`position-block`（ブロック番号）・`position-index`（スケジュールのtかラウンドのt）
- ステージ`stage`＝`board-pad`・`board-split`・`board-schedule`・`board-round`・`board-final`・`board-digest`。表示中の盤面以外は`hidden`
- 計器ドック`dock`＝`match-badge`（`role="status"`）、`digest-groups`、`radix-select`（hex／bin／dec）、`dropped-stats`、コピーのボタン（`copy-hash`・`copy-bytes-spaced`・`copy-bytes-joined`・`copy-sha256sum`・`copy-worksheet`）、`compare-input`と`compare-result`
- 時計`clock`（画面下に固定）＝`clock-first`・`clock-prev`・`clock-play`・`clock-next`・`clock-last`、`clock-range`（`input type="range"`、`aria-valuetext`）、粒度`granularity`（1歩／8歩／1段／1ブロック）、`clock-speed`。段階1a-βでは送りと範囲だけ動き、自動再生と動きは段階1b
- 設定`panel-settings`＝`lang-toggle`は見出し右、`theme-select`（dark／light）、`motion-toggle`（動きを抑える）、理解チェックの保存は段階1c
- `aria-live`の要約は`announcement`（手動の歩と停止時だけ更新）、エラーは`error`（`role="alert"`）
- 外部リンクは`<a target="_blank" rel="noopener noreferrer">`で、許可リストをテストで固定する

### 辞書（messages.js）の約束

- `ja`と`en`のキーは同じ集合。`{name}`の差し込みも同じ。JavaScriptに日本語を書かず、画面の文言は辞書から`t(key, values)`で引く
- キーの名前空間＝`title`・`description`・`language`・`tabs`・`tab.*`・`input.*`・`stats.*`・`cls.*`（文字の分類名）・`error.*`・`preset.*`・`rail.*`・`phase.*`・`board.*`・`dock.*`・`copy.*`・`compare.*`・`clock.*`・`settings.*`・`privacy`・`author`・`repository`・`noscript.ja`・`noscript.en`
- 日本語の文言で使わない語は`test/i18n.test.js`の正規表現に定める（閉じた漢字で書く副詞、長音を省いたカタカナ、直訳調の動詞、前置きの決まり文句、「か所」の表記など。Day117の`test/i18n.test.js`と同じ一覧）。カタカナの長音は省かない（サーバー・ユーザー・ブラウザー・フォルダー・パラメーター・エディター・マネージャー・リポジトリー）。和文と英数字の間に空白を入れない。行末に「：」を置かない
- 改ざんを防ぐ・改ざん防止・改ざんの証明・検証ツール・原像を求める・復号・解読を機能の説明に使わない

### 配色トークンと明暗

`:root`はダーク（青焼き）、`:root[data-theme="light"]`はライト（紙）です。起動時に`app.js`が保存済みの選択、なければ`prefers-color-scheme`から`data-theme`を決めます。contrast.test.jsは両方の`:root`ブロックを読み、組ごとに比を数値で検査します。

| トークン | ダーク | ライト | 用途 |
|---|---|---|---|
| `--bg` | `#0d1117` | `#f6f5f0` | 背景 |
| `--surface` | `#161d27` | `#eeede6` | カード・盤面の下地 |
| `--fg` | `#e8eef4` | `#1b2129` | 本文、ビット1の塗り |
| `--muted` | `#a7b4c2` | `#505a66` | 補助文 |
| `--line` | `#2b3a4a` | `#c9cfd6` | 罫線（装飾） |
| `--bit0` | `#7d8b9a` | `#5c6773` | ビット0の文字 |
| `--role1` | `#56c8ff` | `#0a6c9a` | 役1 シアン（縁・下線・変数名） |
| `--role2` | `#f2b84b` | `#8a5200` | 役2 琥珀 |
| `--role3` | `#c9a3ff` | `#5f3bbf` | 役3 菫 |
| `--role4` | `#6fd48a` | `#1f7a3a` | 役4 緑。一致の印にも使う |
| `--diff` | `#ff6fb5` | `#b5246d` | 差分の塗り |
| `--warn` | `#f2b84b` | `#8a5200` | 警告の文字（役2と同じ値） |
| `--focus` | `#ffffff` | `#000000` | フォーカスの輪郭 2px＋2px |

役色は塗りに使いません（縁・下線・文字だけ）。差分だけ塗り、塗りの上の文字は`--bg`です。等幅は`ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace`、`font-variant-numeric: tabular-nums slashed-zero`。セルの幅はpxで固定し、文字の下限はセル内14px・本文16px。添字は使いません。

### 段階1a-βのテスト

- `test/view.test.js`：描画モデルの純関数。"abc"のトレースでscheduleModel(16)・roundModel(0)・finalModel・digestModelの値、byteGridの行と上限、compareDigestの抜き出し、worksheetの数値がトレースと一致
- `test/html.test.js`：スクリプトの並び（sha256-core.js・input-core.js・presets.js・trace-view.js・messages.js・app.js）、CSPの文字列、referrer、favicon、`[hidden]`、id重複なし、4つの入口と盤面のid、`<a>`の許可リスト、`data-i18n`のキーが辞書にあること
- `test/i18n.test.js`：ja/enのキーと差し込みの一致、禁止語、空白、JSに日本語がないこと、サンプル（プリセット）の入力文字列が辞書の外にあり日英で同じこと
- `test/contrast.test.js`：上の表の全組（文字4.5:1、縁3:1）を明暗で検査
- `test/css.test.js`：`prefers-reduced-motion`の規則、288pxを超える固定幅なし、44pxの操作要素、`[hidden]`、`setAttribute('style'`・`innerHTML`・`insertRule`がapp.jsにないこと

## 先行例

sha256algorithm.com（dmarman）は段階を見せる先行例です。配色・配置・文言・コードは写さず、READMEで名前とURLを挙げます。
