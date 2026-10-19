# SHA-256 Byte Inspectorの開発

このリポジトリーは、SHA-256に渡すバイト列を隠さず見せ、パディングから64ラウンドまでの計算の中身を段階ごとに追えるDay118の教材です。画面に出す値はすべて実際の計算から求め、表示用の固定値を埋め込みません。

## 構成

- `sha256-core.js`：DOMに依存しないUMD。`SHA256ByteCore`を公開。純JSのSHA-256（トレース付き）、パディング、定数の導出、歩のモデル、差分
- `input-core.js`：DOMに依存しないUMD。`SHA256ByteInput`を公開。文字列のUTF-8化と改行・BOMの扱い、16進の読み取り、文字の分類、URLフラグメントの読み書き
- `trace-view.js`：DOMに依存しないUMD。`SHA256ByteView`を公開。トレースと位置から描画モデルを作る純関数
- `presets.js`：言語に依存しない入力のプリセット（`SHA256BytePresets`）。落とし穴の実験の対照ペア、NISTの例題、Day117の再現例。文言は辞書の`preset.<id>`。非ASCIIはエスケープで書く。Day117の例は起点のハッシュを埋め込まず、`day117.build(digestHexOf)`で計算して組み立てる
- `messages.js`：静的・動的な文言の日英辞書
- `app.js`：1枚のページの結線＝5つの節（入力・入力の設定・バイト列・計算・出力）の描画、段階レールと計算の一覧表示（5つのパネルを初回に組み、歩ごとに強調のclassと帯の差し込みだけ更新）、時計（手動の送りと自動再生、現在の行への追従）、見出し右の丸ボタン（言語・明暗・ヘルプ）、ヘルプのダイアログ、URLフラグメントの読み取り、DOM構築
- 学習の流れ・座学・理解チェックは、置き場所を本人に確認してから足す（段階1c）
- `style.css`：幅320px以上、どの幅でも1列（1280px以上は見出し・本文・フッターとも1,040pxで中央）、44px以上の操作要素、製図の意匠、明暗の配色トークン、計算の一覧表示（語の行・64ラウンドの表・差し込みの帯）、画面下に固定の時計（下地`--surface`、上辺に`--role1`の細線）、ヘルプの`<dialog>`
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

入力・ハッシュ・位置を保存しません。localStorageは言語の`sha256-byte-inspector.lang`と、表示設定（`{"theme": "dark" | "light"}`だけ）の`sha256-byte-inspector.display`だけを使います。動きの抑制は設定を持たず、OSの`prefers-reduced-motion`に従います。URLへの書き込みは、読み込んだ`#`を消す`history.replaceState`の1か所だけです。

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
- 定数`REGISTERS`（a〜h）・`PHASES`。各モデルには上の欄に加えて補助の欄がある＝`word`の`value`（数値）、和の`rawHex`（9桁。先頭1桁が`dropped`）、`byteGrid`の`charStart`・`plainStart`・`perRow`・`total`、`paddingModel`の`count`・`elided`・`bitLenHex`・`paddedBytes`・`boundary.remainder`・`boundary.spill`、`positionModel`の`blockNumber`（1始まり。digestは`null`）・`blocks`、`droppedStats`の`t2`・`e`・`a`・`blocks`（第2引数に計算済みのトレースの配列を渡せる）。`droppedStats`の`count`は「`dropped`が1以上の和の数」で、1つの和を1回と数える（"abc"のT1は62/64）。`compareDigest`は連続64桁のほかに旧certutilの「2桁×32を空白区切り」も候補にする。`worksheet`は英語固定で`{lang}`は無視する

### 画面（index.html）の約束

- 1枚のページ（2026-10-19、本人「シンプルにハッシュ値とその挙動をみたいだけ」「タブ機能なくしてよい」）。入口（タブ）・パネル・計器ドック・設定のパネル・動きの抑制のトグルは置かない。骨格＝見出し`header.page-header`（`h1`、右端の丸ボタン3つ、1行の説明）→`main`（どの幅でも1列。先頭に読み上げ用の`announcement`と`error`、次に5つの節、末尾に時計）→フッター（`privacy`・`author`・`repository`の3行）→ヘルプの`dialog#help-dialog`（bodyの最後。閉じた状態で置く）
- `main`はCSS gridの1列（`minmax(0, 1fr)`、gap 16px）。1280px以上は`max-width: 1040px`で中央（32ビットの帯 20px×32 と、8グループ×1段の64桁が入る）。見出し`.page-header`とフッターも同じ1つの規則（`.page-header, main, footer`）で1,040pxにし、罫線の端と丸ボタンがカードの端にそろう（時計は`position: fixed`で別）。768〜1279pxに縦の入口レールはなく、ここも1列
- 5つの節は`section.card`（`aria-labelledby`）で、見出しは`h2.section-title`＝`span.section-number`（数字。縁と文字だけ`--role1`）＋`span[data-i18n="section.*"]`。見出しの読みは「1 入力」だが、番号は辞書の値に入れず`index.html`の札で出す（「1 入力」の空白は和文と英数字の間の空白の規則に当たる）
  1. 入力`input-card`（`h2#input-title`、`section.input`）＝モード`input-mode`（`input-mode-text`／`input-mode-hex`のラジオ）、`text-field`＋`text-input`（textarea、rows=4）、`hex-field`＋`hex-input`（textarea、rows=4、補助文`input.hex.help`）。モードで一方を`hidden`にする。`input-error`（`role="alert"`）、例を選ぶ`preset-select`（落とし穴の実験とDay117の再現例）
  2. 入力の設定`input-options`（`h2#input-options-title`、`section.options`）＝`newline-select`（lf／crlf）、`trailing-newline`、`bom-check`（16進モードでは3つとも`disabled`にし、`app.js`が節に`data-off`属性を立ててラベルも`--muted`にする）、上限の注記`input.limit`、`div#text-notes`（`input.encoding`「文字コードはUTF-8に固定」と`input.text.help`「入力欄の改行はLF…」。16進モードでは`hidden`）
  3. バイト列`bytes`（`h2#bytes-title`。中の`span#bytes-title-text`の`data-i18n`と文字を`app.js`の`syncControls`が切り替える＝文字列モードは`section.bytes`「UTF-8に変換したバイト列」、16進モードは`section.bytesHex`「渡すバイト列（16進のまま）」）＝統計の札`input-stats`（数の札と改行・BOM・正規化の札。警告`warning.*`＝孤立サロゲート・ダンプ形式・ハッシュらしい入力は`div.warning`としてここに並ぶ）、`byte-grid`、`byte-legend`（先頭の`li.legend-caption`が見出し「凡例」。`text`以外の分類が格子にあるときだけ`hidden`を外し、札の中身はその分類の最初のバイト＝`lf`なら`0a`。上の罫線で格子と分ける）
  4. SHA-256の計算`compute`（`h2#compute-title`、`section.compute`。2026-10-19本人決定＝案A「全部を1画面に並べる」。先行例の配色・配置・文言・コードは写さない）＝段階レール`stage-rail`（6つのボタン`pad`・`split`・`schedule`・`round`・`final`・`digest`、`data-phase`、現在位置に`aria-current="step"`。押すと位置をその段階の先頭に合わせ、該当パネルの見出しへ`scrollIntoView({block: 'start'})`してフォーカス。「入力」のボタンは置かない）、`p.position-line`（`position-block`＝ブロックが2つ以上のときだけ「ブロックn／total」（パディングでは空）・`position-index`＝段階の名前とt）、ステージ`stage`（sr-onlyの`h3#stage-title`と、上から5つのパネル。すべて常に表示し、現在位置のあるパネルに`.is-active`（縁が`--role1`））
     - (a) `board-block`（`compute.block.title`）＝ブロックが2つ以上なら序数の札`div.block-tabs > button[data-block]`（現在に`aria-current="true"`。押すとそのブロックの`split`へ）、パディングの札`div.padding-segments`（このブロックに入る区分だけ＝本体・`80`・ゼロ詰め・長さ。`pad`の位置で`.is-current`）、16行`div.w-rows > div.w-row`（`split`の位置で`.w-rows.is-current`）。各行＝`span.w-index`「W[t]」＋`span.tile`（基数に従う）＋`span.w-tag`（空）＋`.bits`（各`.bit`に区分の`k-message|k-one|k-zeros|k-length`。縁の色で区分を示す）。注記＝`compute.block.note`、最後のブロックには`compute.block.lengthNote`、`board.pad.blocks`＋`board.pad.boundary`
     - (b) `board-schedule`（`compute.schedule.title`）＝凡例`ul.row-legend`（`legend-key.is-current|is-direct|is-sigma`＝現在のW[t]・そのまま加える語W[t−16]とW[t−7]（`--role2`）・σに入れる語W[t−15]とW[t−2]（`--role3`））、注記`board.schedule.fromBlock`、64行の`.w-rows`（t<16は`w-tag`が`compute.schedule.fromBlock`）。`schedule`の位置では行tに`.is-current`、参照元4行に`data-ref="16|15|7|2"`と`w-tag`「t−n」、行tの直後に帯の差し込み`div.insert.insert-schedule`（参照する4語の札、σ0・σ1の各5本の帯、4項の和、W[t]の帯。要素は1度だけ作り、歩ごとに値を書き換えて移す）
     - (c) `board-round`（`compute.round.title`）＝`h4`（`compute.round.registers`「ラウンドtの前の作業変数」。ラウンドより前の段階ではt=0の前、最終加算以降は`compute.round.registersAfter`でラウンド63の後）、`div.register-lanes`（a〜hの8本の帯）、`div.register-lanes.kw-lanes`（K[t]・W[t]。`round`以外では`hidden`）、`round`の位置ではその直後に`div.insert.insert-round`（Σ1・Ch・Σ0・Maj・T1・T2・新e・新aの帯と和、ラウンド後の札）、`h4`（`compute.round.table`）＋注記`compute.round.tableHint`、表`div.round-table`＝`div.rt-head[aria-hidden]`（t・a〜h。768px以上だけ表示）＋64個の`button.rt-row[data-t]`（`span.rt-index`＋8個の`span.rt-cell > span.rt-key（a〜h。768px以上は読み上げ専用）＋16進8桁`。767px以下は`minmax(10ch, 1fr)`で折り返し、768px以上は`3ch repeat(8, minmax(8ch, 1fr))`の9列。現在の行に`.is-current`と`aria-current="step"`。押すとそのラウンドへ位置が移る。表は基数に関わらず16進）
     - (d) `board-final`（`board.final.title`）＝2ブロック目以降は注記`compute.block.chain`、8つの`div.final-lane`（`H_in[i]`の帯、作業変数の帯（`--role2`）、生の和と捨てた桁の`.sum`、`H_out[i]`の帯（`--role4`））
     - (e) `board-digest`（`board.digest.title`）＝`div.digest-lanes`（H[0]〜H[7]の帯）、`code.digest-hex`（64桁）、注記`board.digest.concat`。5節「出力」へつながる
     - 描画の規則＝`buildCompute`が5つのパネルをブロック・ブロック数・言語・基数ごとに1度だけ組む（ビットの行は1つの雛形を`cloneNode`）。結果だけが変わったとき（入力の編集）は`refillCompute`が既存の要素へ値を書き直す（パディングの札だけ作り直す）。歩が進んだときは`updateCompute`が強調のclassを付け替え、作業変数の帯と差し込みの帯を書き直し、差し込みを移すだけ。"abc"で差し込みを含めて約4,300セル。手動の歩と自動再生では`scrollToShow`が現在の行（`pad`＝札、`split`＝(a)の見出し、`schedule`＝行t、`round`＝作業変数の見出し、`final`・`digest`＝パネルの見出し）を`scrollIntoView({block: 'nearest'})`し、固定の時計に隠れない位置まで、さらに差し込みが見えるところまで（行が最上部に来るまでを限度に）送る。利用者のホイール・タッチ・スクロールバーのスクロールから1秒間は追わない（`FOLLOW_PAUSE`）
     - 入力中の負荷＝文字列と16進の入力欄の`input`では、入力・バイト列・出力をその場で書き、計算の節は打鍵が`COMPUTE_DELAY`（300ms）止まってから1度だけ書き直す（待つ間は`#compute.is-stale`で薄く表示。Web Cryptoの答えも待つ間は節を書き直さない。時計を動かしたときはすぐに書き直す）。`fillBits`は変わったセルだけ書く。各パネル`.board`は`content-visibility: auto`（画面外のパネルの配置と描画を省く）
     - 末尾にあふれの統計`p#dropped-stats`（`stage.dropped`、小さく。結果がないときは空で`display: none`）
  5. 出力`result`（`section.card.result`、`h2#result-title`、`section.result`）＝`div.result-head`に見出しと一致バッジ`match-badge`（`role="status"`、`data-state="ok|ng|unknown|pending"`、文言は`result.match.*`。右端に寄せる）、帯`digest-groups`（8グループ×8桁。等幅・`tabular-nums`、枠2px`--line`、下地`--bg`（入力欄と同じ「井戸」）、文字`--fg`。767px以下は2列×4段で1.375rem、768〜1279pxは4列×2段で1.5rem、1280px以上は8列×1段で1.375rem＝帯の内側982pxに8×8chと7つの12pxの隙間が入る最大の文字サイズ（1.5remは0.6em幅の等幅で約1,009px必要で入らない）。2進は1列、1280px以上は2語×4段。空入力でも`e3b0c442…`を出す。16進エラーとWeb Crypto不一致のときは中身を空にし、枠と見出しは残す）、注記`p.result-note`（`result.emptyNote`。`app.js`が空入力のときだけ`hidden`を外す）、基数`radix-select`（hex／bin／dec。盤面の札と出力の帯の両方に効く。2進は語ごとに32桁を8桁ずつ空白で区切り、10進は語ごとの値）、コピー`div.actions.result-actions`（`role="group"`、`aria-labelledby="copy-title"`。行頭に小見出し`span#copy-title.actions-label`「コピー」、ボタンの文言は「ハッシュ（64桁）」のように「をコピー」を付けない。隙間8px/12pxとボタンの横の余白0.5remで、1,040pxでは5つが1行に入る（実測））＝`copy-hash`・`copy-bytes-spaced`・`copy-bytes-joined`・`copy-sha256sum`・`copy-worksheet`（`copy-worksheet`はラウンドの位置にいるときだけ有効）、退避欄`copy-fallback`（`app.js`がクリップボードに書けなかったときに`.result-actions`の直後へ作る読み取り専用のtextarea。`aria-label`は`copy.fallback`）、比較欄`compare-input`（textarea、rows=1。共通の規則で44px以上）と`compare-result`（`role="status"`）
- `app.js`が組む動的なDOMのクラス名は`style.css`が定める＝バイト格子`.byte-row > .byte-offset + .byte-cells > .byte-cell[data-cls]`（上限超は`pre.byte-plain`）、帯`.lane > .lane-head(.lane-label + .tile) + .bits > .bit(.is-one|.is-diff|.is-current|.is-source|.is-result|.k-message|.k-one|.k-zeros|.k-length)`、札`.tiles > .tile`（中の値は`span`）、語の行`.w-rows > .w-row(.is-current|[data-ref]) > .w-index + .tile + .w-tag + .bits`、差し込み`.insert(.insert-schedule|.insert-round)`、作業変数`.register-lanes(.kw-lanes)`、表`.round-table > .rt-head + .rt-row(.is-current) > .rt-index + .rt-cell > .rt-key`、最終加算`.final-lanes > .final-lane`、ダイジェスト`.digest-lanes`・`code.digest-hex`、凡例`.row-legend > li > .legend-key`、和`.sum > .sum-row(.is-result)`（ラベルは左・値は右寄せ。768px以上は`max-width: calc(32 * var(--bit-cell) + 9ch + 53px)`＝1文字ラベルの帯（e・f・g・a・b・c）と同じ幅で、値の右端がその帯の右端の縦線に乗る。768〜800pxは帯が頭の下に折れ、箱が盤面より広いので効かない）、一致バッジ`#match-badge[data-state="ok|ng|unknown|pending"]`
- 時計`clock`（`main`の末尾。画面下に`position: fixed`、`role="group"`で`aria-labelledby="clock-title"`。767px以下ではtextareaのフォーカス中に隠し、フォーカスが離れて300ms後に戻す。2026-10-19本人の指摘＝気づきにくいので見出しと下地を付ける）＝下地`--surface`、上辺に1pxの`--role1`の線（発光なし）。`div.clock-head`＝太字の見出し`strong#clock-title`（`clock.title`「計算の送り」）とその横の現在位置`span#clock-position`（位置の行と同じ文言。14px）、`div.clock-row.clock-row-range`＝`clock-range`（`input type="range"`、`aria-valuetext`、最小120px）と`clock-speed`（0.25〜8x、既定1x）、`div.clock-row.clock-row-buttons`＝`clock-first`・`clock-prev`・`clock-play`・`clock-next`・`clock-last`と粒度`granularity`（1歩／8歩／1段／1ブロック）。768px以上は1行（`grid-template-columns: auto minmax(120px, 1fr) auto`、見出しの欄は280pxまでで位置の文が下に折れる）、767px以下は見出し＋位置／範囲＋速度／ボタン＋粒度の3行で高さ150px以内（実測127〜145px）。自動再生＝`clock-play`で再生／停止（再生中は`aria-pressed="true"`、ラベル`clock.pause`、文字は「‖」）、`setTimeout`の連鎖で1歩ずつ（`PLAY_INTERVAL`1,000ms÷速度。`setInterval`は使わない）、末尾で止まる（末尾で再生を押すと先頭から）、速度の変更で再アーム、入力の再計算で停止。空白キーはtextarea・input・select・button・aにフォーカスがないときだけ再生／停止。`body`の`padding-bottom`は`var(--clock-height)`で、`app.js`が起動時・`resize`・位置の文の更新時（1フレームに1回）に`#clock.offsetHeight`＋8pxを`documentElement.style.setProperty('--clock-height', …)`で書く（`style.css`の値は読み込み前の控え）。これが唯一のCSSOMへの書き込み
- 見出し右の`div.header-tools`（flex、`justify-content: flex-end`、gap 8px）に丸ボタン`lang-toggle`・`theme-toggle`・`help-button`の3つ（`button.icon-button`、44×44pxの円、1px`--border`、下地`--surface`、hoverとfocus-visibleで縁を`--role1`に）。アイコンは`index.html`の静的なインラインSVG（`viewBox="0 0 24 24"`、`fill="none"`、`stroke="currentColor"`、`aria-hidden="true"`、`focusable="false"`。style属性とon*属性は使わない。幅と高さはCSSで22px。置き場所は見出しとヘルプの閉じるボタンだけ）＝言語は翻訳の記号`.icon-translate`、明暗は太陽`.icon-sun`と月`.icon-moon`を`hidden`属性で切り替える、ヘルプは丸囲みの「?」`.icon-help`（`aria-haspopup="dialog"`、ラベル`help.title`）（ダーク表示中は太陽＝押すとライト、ライト表示中は月＝押すとダーク。SVG要素には`hidden`プロパティがないので`toggleAttribute('hidden', …)`で切り替え、検査も`hasAttribute`で読む）。`aria-label`と`title`は`data-i18n-label`から＝`language`（相手の言語名）、`theme.toLight`／`theme.toDark`（`app.js`が`applyDisplay`で書き換える）。`aria-pressed`は使わず、ラベルで次の状態を言う。767px以下ではタイトルの下の行で右寄せ、768px以上ではタイトルの行の右端（タイトルは中央のまま）。言語の切り替えは描画だけで、入力・位置・ダイジェストを保持する
- 盤面`.board`は390px未満では横の枠と余白を持たない（320pxでカードの内側は274px、16セル×16px＋15の隙間の帯は271px。盤面の横の枠と余白を足すと入らない）。上の罫線1本で位置の行と区切る。390px以上はカードと同じ枠と余白。768〜800pxは`--bit-gap: 0`と盤面の横余白8pxで32セルの帯を収める
- ヘルプ`dialog#help-dialog.help-dialog`（`aria-labelledby="help-title"`。`help-button`か、textarea・input・selectにフォーカスがないときの「?」キーで`showModal()`。開いたら`h2#help-title`（`tabIndex=-1`）にフォーカス、`button#help-close`（丸ボタン、`.icon-close`、ラベル`help.close`）・Esc・背景クリック（`click`の`target`がdialog自身＝`.help-inner`が中身の全部を覆う）で閉じ、`close`で`help-button`へフォーカスを戻す。開いている間は時計のキーを受けない。中身`div#help-body`は`buildHelp`が辞書`help.*`から組む＝できること（3項目）／できないこと（改ざんの検知や原像の計算は名乗らない。本番は`crypto.subtle`）／使い方（上から読む流れ、時計の送り）／キーボード（`dl.help-keys`、`kbd`で←→・Shift＋←→・PageUp/PageDown・Home/End・1〜6・Space・?）／入力のコツ／端末内で処理（`privacy`の文と、参考の名前`help.reference`。外部リンクは置かない）。見た目は製図＝下地`--surface`、1px`--line`、`max-width: 640px`、幅`calc(100% - 32px)`、`max-height: calc(100dvh - 32px)`で縦スクロール、`::backdrop`は`--bg`の70%
- `aria-live`の要約は`announcement`（手動の歩と停止時だけ更新。自動再生中は黙る）、エラーは`error`（`role="alert"`）。どちらも`main`の先頭に置く
- 外部リンクは`<a target="_blank" rel="noopener noreferrer">`で、許可リストをテストで固定する
- URLの`#`の受け取り（`text`／`hex`／`m`／`at`／`r`／`l`／`d`）は変えない。`dock`というid、「計器」「入口」「タブ」の語、`tabs`・`tab.*`・`guide.*`・`learn.*`・`settings.*`・`dock.*`の辞書キーは使わない。学習の流れ・座学・理解チェックの置き場所は本人に確認する（段階1c）

### 辞書（messages.js）の約束

- `ja`と`en`のキーは同じ集合。`{name}`の差し込みも同じ。JavaScriptに日本語を書かず、画面の文言は辞書から`t(key, values)`で引く
- キーの名前空間＝`title`・`description`・`language`・`section.*`（5節の見出し6個＝`input`・`options`・`bytes`・`bytesHex`・`compute`・`result`。値に番号を含めない）・`input.*`・`stats.*`・`byte.*`・`cls.*`（文字の分類名。`SHA256ByteInput.CLASSES`と同じ15個）・`warning.*`・`error.*`・`preset.*`・`rail.*`（`rail.title`・6段階・`rail.block`。`rail.input`は廃止）・`stage.*`（`stage.title`・`stage.dropped`）・`phase.*`（`positionModel.labelKey`が引く6個）・`board.*`（帯・札・和の文言。`board.pad.title`・`board.split.title`・`board.split.word`・`board.schedule.title`・`board.round.title`・`board.round.before`は段ごとの盤面の廃止で使わない）・`compute.*`（一覧表示の見出し・凡例・札・注記＝`compute.block.*`・`compute.schedule.*`・`compute.round.*`・`compute.final.*`。jaは体言止め）・`result.*`（`result.emptyNote`・`result.match.*`・`result.radix`・`result.radix.*`）・`copy.*`（小見出し`copy.title`と`copy.fallback`を含む）・`compare.*`・`clock.*`（`clock.title`「計算の送り」は時計の見出し）・`help.*`（ヘルプの見出しと本文。jaの本文はですます調、外部リンクなし）・`theme.*`・`privacy`・`author`・`repository`・`noscript.ja`・`noscript.en`・`busy`・`ready`。`tabs`・`tab.*`・`guide.*`・`learn.*`・`settings.*`・`dock.*`は入口と計器ドックの廃止で使わない。`test/i18n.test.js`がこの一覧を検査する
- 日本語の文言で「計器」「入口」「タブ」を使わない（英語でも instruments・dock・entrance・tab を使わない。`TAB (09)`の制御文字名は別）
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
| `--border` | `#7d8b9a` | `#5c6773` | 操作要素の縁（`--bit0`と同じ値。背景と3:1以上） |

役色は塗りに使いません（縁・下線・文字だけ）。差分だけ塗り、塗りの上の文字は`--bg`です。プレースホルダーの文字は`::placeholder { color: var(--muted); opacity: 1 }`で描きます（ブラウザー既定の灰色は明暗とも4.5:1未満）。等幅は`ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace`、`font-variant-numeric: tabular-nums slashed-zero`。セルの幅はpxで固定し、文字の下限はセル内14px・本文16px。添字は使いません。

### 画面側のテスト

- `test/view.test.js`：描画モデルの純関数。"abc"のトレースでscheduleModel(16)・roundModel(0)・finalModel・digestModelの値、byteGridの行と上限、compareDigestの抜き出し、worksheetの数値がトレースと一致
- `test/html.test.js`：スクリプトの並び（sha256-core.js・input-core.js・presets.js・trace-view.js・messages.js・app.js）、CSPの文字列、referrer、favicon、`[hidden]`、id重複なし、入口・タブ・パネル・`#dock`・`motion-toggle`の不在、`main`の先頭の`announcement`と`error`、文書順1→5の5節（idと`h2`の番号の札＋`section.*`）、各節の中身、4節の5パネル(a)〜(e)の順と見出しキー（どれも`hidden`でない）、6ボタンのレール（`input`なし）、コピーの小見出しと5ボタン、凡例の見出し`li`、時計の見出しと位置の要素と3行の構造、ヘッダーの丸ボタン3つ、ヘルプの`dialog`（フッターの後、`h2#help-title`、`help-close`、空の`help-body`、リンクなし）、SVGが5つ（見出しとヘルプの閉じるボタンだけ）、`<a>`の許可リストとフッターの3行、`data-i18n`のキーが辞書にあること
- `test/i18n.test.js`：ja/enのキーと差し込みの一致、名前空間（`section.*`・`compute.*`・`help.*`を含み、`tab`・`guide`・`learn`・`settings`・`dock`を含まない）、消したキーの不在（`rail.input`と段ごとの盤面の見出しを含む）、節の見出し6個の値（番号なし）、`clock.title`と`copy.title`の値、コピーのボタンが「をコピー」を繰り返さないこと、`board.pad.length`の短縮、ヘルプにURLがなくFIPS 180-4と`crypto.subtle`を名指すこと、禁止語と「計器」「入口」「タブ」の不在、空白、JSに日本語がないこと、サンプル（プリセット）の入力文字列が辞書の外にあり日英で同じこと
- `test/app.test.js`：`t()`の差し込み名、動的キーの接頭辞（`result.match.`を含む）、条件分岐で選ぶキー（`compute.round.registers*`・`help.*`・`clock.play|pause`）の存在、`$()`のidが`index.html`にあること、`PANELS`・`PANEL_OF`・`RAIL`（6段階、数字1〜6）、tab・panel・dock・motionの処理の不在、storageのキーが`.lang`と`.display`の2つで`display`が`{theme}`だけ、丸ボタン、基数が一覧と出力の両方に効くこと、退避欄の置き場所、`buildCompute`／`refillCompute`／`updateCompute`の条件と差分更新（雛形の`cloneNode`、classの付け替え、表のテキストノードの書き換え、行を押す・序数の札）、自動再生（`setTimeout`の連鎖、`setInterval`なし、末尾で停止、`clock.pause`、空白キーの条件）、追従（`scrollIntoView({block: 'nearest'})`、`FOLLOW_PAUSE`、ホイール・タッチ・スクロールの受信、`renderPosition(false)`が5か所）、ヘルプ（`showModal`／`close`、フォーカスの行き帰り、背景クリック、「?」キーの条件、リンクを作らない）、`--clock-height`の実測
- `test/contrast.test.js`：上の表の全組（文字4.5:1、縁3:1）を明暗で検査。時計とヘルプの下地`--surface`に対する`--fg`・`--muted`・`--role1`・`--border`
- `test/css.test.js`：`prefers-reduced-motion`の規則と`data-motion`の不在、`@keyframes`なし、288pxを超える固定幅なし（`max-width`は280・640・1040・1288・1320だけ）、`main`の1列（gap 16px）と1280pxの`max-width: 1040px`（`.page-header, main, footer`の1つの規則）、盤面の枠（390px未満は横の枠なし、768〜800pxの詰め）、和`.sum`の幅、出力の帯（枠2px、下地`--bg`、1.375rem×2列／1.5rem×4列／1.375rem×8列、1280pxの2進は2列）、語の行（横の余白なし、`.is-current`の縁と輪郭、`data-ref`の役色）、ビットの区分、差し込みの線、表（`minmax(10ch, 1fr)`と768pxの9列、見出し行の表示）、時計（`--surface`と`--role1`の上辺、見出しの行、768pxの1行）、ヘルプ（640px、`--surface`、`::backdrop`）、コピーの行と凡例、44pxの操作要素と`::placeholder`の色、`[hidden]`、`setAttribute('style'`・`innerHTML`・`insertRule`がapp.jsにないこと

## 先行例

sha256algorithm.com（dmarman）は段階を見せる先行例です。配色・配置・文言・コードは写さず、READMEで名前とURLを挙げます。
