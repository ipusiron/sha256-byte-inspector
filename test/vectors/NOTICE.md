# Test vectors: provenance and notices

This directory holds the original test-vector documents that the SHA-256 Byte Inspector tests read, and the JSON files that the scripts in `test/tools/` extract from them. No expected value is typed in by hand: each one is either extracted from an original by those scripts or recomputed with `node:crypto` at test time. The originals are data; no line of them is executed.

All originals were retrieved on 2026-10-19. The SHA-256 values below were computed over the files as stored here. `nist-sha256-examples.txt`, `sha2-additional.txt` and the `.rsp` files end their lines with CRLF (a few lines of the two text renderings with LF), so readers split on `\r?\n`; the two text renderings also contain form feeds at page breaks.

## Originals

| File | Source | Size | SHA-256 of the stored file |
|---|---|---|---|
| `nist-sha256-examples.txt` | NIST, "SHA-256 Examples with Intermediate Values" (`SHA256.pdf`), <https://csrc.nist.gov/CSRC/media/Projects/Cryptographic-Standards-and-Guidelines/documents/examples/SHA256.pdf>, linked from <https://csrc.nist.gov/projects/cryptographic-standards-and-guidelines/example-values> | 19,154 | `ee67c755ebd6ac069b30d43273391f6f3119afc1250d77b38e0a2fe6436d44c9` |
| `sha2-additional.txt` | NIST, "SHA-2 Additional Test Data" (`SHA2_Additional.pdf`), <https://csrc.nist.gov/CSRC/media/Projects/Cryptographic-Standards-and-Guidelines/documents/examples/SHA2_Additional.pdf>, linked from the same page | 6,570 | `5600443018822d973eb9825f7983c6dc4e2397d5c597bf4f786f132eaafcc76b` |
| `nist-cavp/Readme.txt` | NIST CAVP, `shabytetestvectors.zip` (see below) | 831 | `24bf370543f9521f7eb44f49e8d489ac9e45a21126f883d8e32e7fffd1d10227` |
| `nist-cavp/SHA256ShortMsg.rsp` | same zip; 65 records, Len 0 to 512 bits | 10,299 | `75e1cb83994638481808e225b9eb0c1ebd0c232d952ac42b61abce6363be283c` |
| `nist-cavp/SHA256LongMsg.rsp` | same zip; 64 records, Len 1304 to 51200 bits | 426,209 | `6fac36f37360bcf74ffcf4465c18e30d6d5a04cc90885b901fc3130c16060974` |
| `nist-cavp/SHA256Monte.rsp` | same zip; one seed and 100 checkpoints | 8,751 | `29ea30c6bb4b84e425fb8c1d731c6bb852dac935825f2bd1143e5d3c4f10bfb9` |
| `rfc6234.txt` | RFC 6234, "US Secure Hash Algorithms (SHA and SHA-based HMAC and HKDF)", D. Eastlake 3rd and T. Hansen, May 2011, <https://www.rfc-editor.org/rfc/rfc6234.txt> | 236,573 | `8f39f02a57bfd1da15634706724a585766e6223f77ecdaf243cad16cd3a1aa1b` |
| `day117-chain-vectors.json` | Day117 Hash Chain Tamper Trainer, `test/chain-vectors.json`, <https://github.com/ipusiron/hash-chain-tamper-trainer> | 2,857 | `a5c1b2d94a4342188261d7db9f942a8aff940f5b04f8d030de69219459b4aa5c` |

Notes on the originals:

- The two `.txt` renderings of NIST PDFs were made with `pdftotext` at retrieval and are kept as produced (the layout depends on the pdftotext version, which is why their own SHA-256 is recorded). The PDFs themselves: `SHA256.pdf` is 99,090 bytes with SHA-256 `7006b6549dad2fc8c6f29417a921f2e48208157ef496a7e1e1d7d17c5cc1e7db`; `SHA2_Additional.pdf` is 44,672 bytes with SHA-256 `95f25cb0c8a0636c7cd5773469883d3cf802d8e8265dcbb13cca1dad3be3c3b3`.
- The CAVP files come from "SHA Test Vectors for Hashing Byte-Oriented Messages", <https://csrc.nist.gov/CSRC/media/Projects/Cryptographic-Algorithm-Validation-Program/documents/shs/shabytetestvectors.zip>, linked from <https://csrc.nist.gov/projects/cryptographic-algorithm-validation-program/secure-hashing>. The zip is 4,909,729 bytes, SHA-256 `929ef80b7b3418aca026643f6f248815913b60e01741a44bba9e118067f4c9b8`, and holds 29 files; the four files here are byte-identical copies of its entries `shabytetestvectors/Readme.txt`, `SHA256ShortMsg.rsp`, `SHA256LongMsg.rsp` and `SHA256Monte.rsp`. The test procedures (short messages, selected long messages, Monte Carlo) are described in SHAVS, <https://csrc.nist.gov/CSRC/media/Projects/Cryptographic-Algorithm-Validation-Program/documents/shs/SHAVS.pdf>. In the `.rsp` files the record with `Len = 0` prints `Msg = 00` but means the empty message.
- `rfc6234.txt` is the unmodified RFC text. Section 8.5 ("The Test Driver", shatest.c) holds the test patterns and expected digests.
- `day117-chain-vectors.json` is an unmodified copy of Day117's file. Its values were generated with Python hashlib outside that repository (see its `test/chain.test.js`).

## Extracted files

| File | Made by | Contents |
|---|---|---|
| `nist-sha256-rounds.json` | `node test/tools/extract-nist-examples.js` | 2 samples ("abc" and the 56-byte two-block message), 3 blocks: Hin, W[0..15], a..h after each of the 64 rounds, Hout, digest |
| `sha2-additional-sha256.json` | `node test/tools/extract-sha2-additional.js` (`SHA256_SLOW=1` also recomputes #11 to #13) | the 13 SHA-256 entries |
| `rfc6234-sha256.json` | `node test/tools/extract-rfc6234.js` | the 7 byte-oriented cases (1, 2, 3, 4, 6, 8, 10); cases 5, 7 and 9 carry extra bits and are left out |
| `day117-inputs.json` | `node test/tools/extract-day117-inputs.js [path to a Day117 checkout]` | 5 inputs of the "access" sample: seed, row 1, row 2 with its time changed to 09:06, trailer, row 1 with the fixed seed of 64 zeros |

The `.rsp` files are read directly by `test/tools/rsp.js` (`parseMsgFile`, `parseMonte`); no JSON is derived from them. `npm test` runs the extraction scripts in check mode: each one re-extracts its JSON from the original and fails if the committed JSON differs, without writing anything.

## Notices

### NIST documents and test vectors

`nist-sha256-examples.txt`, `sha2-additional.txt` and the files in `nist-cavp/` are works of NIST. This data/work was created by employees of the National Institute of Standards and Technology (NIST), an agency of the Federal Government. Pursuant to title 17 United States Code Section 105, works of NIST employees are not subject to copyright protection in the United States. This data/work may be subject to foreign copyright.

### RFC 6234 (IETF Trust)

`rfc6234.txt` is an IETF document. Its copyright notice reads: "Copyright (c) 2011 IETF Trust and the persons identified as the document authors. All rights reserved. This document is subject to BCP 78 and the IETF Trust's Legal Provisions Relating to IETF Documents (http://trustee.ietf.org/license-info) in effect on the date of publication of this document." The file is kept unmodified; the tests use the test patterns and digests of section 8.5 as data only, and none of the C code is reused.

### Day117 Hash Chain Tamper Trainer

`day117-chain-vectors.json` is from Hash Chain Tamper Trainer (Day117 of the same series by the same author), MIT License, Copyright (c) 2026 ipusiron.
