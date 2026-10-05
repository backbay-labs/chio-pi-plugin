# Task 7b: Roadmap crosswalk, 0.2.0 candidate and cold consumers

Scope: the second and third parts of Task 7 of the authorized full roadmap, on
`feat/pi-full-roadmap-20261004`, starting from reviewed `e3c72fe`. Task 7a's
workflow fixture and its retained results are unchanged. The primary checkout,
frozen bridge, operator and qualification artifacts, the frozen `0.1.0`
evidence and its hashes, and all earlier records are unchanged. Nothing was
pushed or published.

Confidence: high for the packaging, installation and import observations below
on macOS arm64. They are installation and component evidence. They do not
qualify a kernel, provider, native service or any runtime acceptance gate.

## Commits

| Commit | Change |
| --- | --- |
| `ced0f96` | `fix: run chio-coding-resource through npm executable symlinks` |
| `14b94d9` | `build: stage the 0.2.0 candidate with cold consumer qualification` |
| `1e611c5` | `docs: map the roadmap implementation and route current qualification` |
| `2059150` | `fix: grant no unfiltered metadata access in macOS recipe policies` |

The candidate of record is packed from `2059150620d654093cddbca1f100630d175394be`.
This record and the retained consumer evidence are committed afterwards.

## Toolchains

macOS 26.4 build 25E246, Darwin 25.4.0 arm64. Every command below names its Node.

| Name | Binary | SHA-256 | npm |
| --- | --- | --- | --- |
| Homebrew Node 25.5.0 | `/opt/homebrew/Cellar/node/25.5.0/bin/node` | `dd15588a84f33431b4e616b04a2d0f79be676b1d537a43f0537a62279c592d21` | 11.8.0 |
| Official Node 22.19.0 | nodejs.org `node-v22.19.0-darwin-arm64.tar.gz`, scratch copy outside the user's toolchain | `0d005c18e095027ca8f9fe1cc1126f767ee4ad7b004f4d6fb781ec4228a7c5d1` | bundled 10.9.3, or Homebrew's 11.8.0 CLI |
| Host default Node 26.7.0 | `~/.hermes/node/bin/node` | `a9bd0630891c2dcdee70de88270fee2cc0c4a9e76495039dd3b4f91c5e6b71df` | not used |

The Node 22.19.0 tarball matched its published SHA-256
`c59006db713c770d6ec63ae16cb3edc11f49ee093b5c415d667bb4f436c6526d` from
`https://nodejs.org/dist/v22.19.0/SHASUMS256.txt`, fetched over HTTPS; the
checksum file's signature was not verified. The user's global toolchain was not
changed. Node 26.7.0 ran only the confinement diagnostics below.

## Crosswalk and routing

[ROADMAP-IMPLEMENTATION.md](../../ROADMAP-IMPLEMENTATION.md) maps all twelve
research ideas to shipped entrypoints, current evidence with its command, native
acceptance prerequisites and remaining limitations, and gives a runnable check
for every shipped entrypoint. Rows 6, 8 and 10 are labeled interfaces with no
installed native service. Row 11 states that arbitrary codemode stays disabled
and bounded `read_many` is the implemented aggregate alternative.

The README's current qualification link now routes to `FINAL-QUALIFICATION.md`
and names its frozen scope: archive `ec609539...`, Pi 0.85.1, macOS. Installation
and release commands name the `0.2.0` candidate, exact Pi 1.0.2 and the optional
exact Pi Durable 1.0.2. `RELEASE-QUALIFICATION.md` gains a candidate section; its
September record of the `0.1.0` workflow change is labeled as such and otherwise
unchanged. No historical qualification record changed.

## Archive decision

The package `files` selection now excludes `docs/superpowers/`. Plans,
specifications and task evidence are development records. Task evidence records
candidate and consumer hashes, so shipping it would make each evidence commit
change the candidate it describes. Task 7a's machine-readable results also hold
local `/private/var/folders/...` temporary paths in `beforeTest.output`; they stay
unchanged in the source repository and are no longer packaged. Retained consumer
provenance lives under `evidence/`, which was never packaged. Packaged guides
that link to task records now point into the source repository; those links do
not resolve inside an installed archive.

Before committing this record, the tree was packed again with all retained
evidence files present and uncommitted (Homebrew Node 25.5.0). The archive was
byte-identical to the candidate of record (see Reproducibility).

## Commands and results

From the worktree root, clean at `2059150`, Homebrew Node 25.5.0 first on `PATH`:

```sh
npm run typecheck && npm test
npm run pack:release -- /tmp/chio-pi-roadmap-release
```

Typecheck exited 0. `npm test` passed **394 of 394** with zero failures,
cancellations or skips in 122.2 s. This is 386 earlier tests plus one
coding-resource symlink regression, one Seatbelt policy regression and six
`qualify-release` tests.

The packer exited 0. Before and after packing, `git status --porcelain` was empty
and these source hashes were unchanged:

| File | SHA-256 |
| --- | --- |
| `package.json` | `c9c6637bc732efdcc449098bb27110d78cf6931e9dc5f4cdb8d45e1b655a39e6` |
| `package-lock.json` (builder lock) | `d5ed351fe7b2fecbfcc3f027aa80701c98d40a9c1fc665b36231139c37713de2` |
| `vendor/chio-bridge-0.3.0-7d9e34f7408a.tgz` | `7d9e34f7408a316e35125982a23faaecfd2f31f4da6b50ca8eab287c2c918f67` |

| Candidate | Value |
| --- | --- |
| Artifact | `chio-pi-plugin-0.2.0.tgz`, 5,792,382 bytes, 1,162 files |
| SHA-256 | `0701bfc7c689424628df96988f890b37bcbdf7b888e8ec1307411982d1d45b3b` |
| npm integrity | `sha512-czY9yqs5ki0GNioeUHu0Vh1LSFwZlg2GmV0hMHBX4lrftgSFqK+y+uU4D3qVu90htzXPtgkCjezUJZz6fxVjPA==` |
| Builder provenance | `sourceDirty: false`, Node v25.5.0, npm 11.8.0, darwin arm64 |
| Bundled | `@chio/bridge@0.3.0` with `@chio-protocol/sdk@0.1.1-rc.1`, `yaml@2.9.0`, `zod@3.25.76` |
| Registry dependencies | exact `ajv@8.17.1`, `typebox@1.3.7`, with builder-lock integrity |

Consumers, once per toolchain, each with new work and evidence directories:

```sh
node scripts/qualify-release.mjs --release /tmp/chio-pi-roadmap-release \
  --work NEW_WORK_DIRECTORY --evidence NEW_EVIDENCE_DIRECTORY [--npm-cli NPM_CLI_JS]
```

| Node and npm | Exit | Base consumer lockfile SHA-256 | Durable consumer lockfile SHA-256 | Time |
| --- | ---: | --- | --- | ---: |
| 25.5.0, npm 11.8.0 | 0 | `970e467b5c3a7fb228a32ab1a00356d101080b455beb44228fdec4d132a70474` | `d65d7e6e907434fabb43bb13f25e12f3a10f118e2e7cee01f37dbfb64b8531a7` | 72.7 s |
| 22.19.0, npm 10.9.3 | 0 | `7b7662f4977e45e3fb4aeaebbdb059105b2ba99e008762f28e91ec83e83c0ce3` | `45823f5293183b7ae8d046bca7d35fa8acad46573e83c8c444c938ece43041e2` | 80.0 s |
| 22.19.0, npm 11.8.0 | 0 | `970e467b5c3a7fb228a32ab1a00356d101080b455beb44228fdec4d132a70474` | `d65d7e6e907434fabb43bb13f25e12f3a10f118e2e7cee01f37dbfb64b8531a7` | 91.0 s |

All runs passed the three host and builder checks and all ten checks of each
consumer: peer-first nested installation from an empty cache; relative
`file:../chio-pi-plugin-0.2.0.tgz` dependency with lock integrity equal to the
artifact; `npm ls --all` without problems; staged metadata, export and bin
containment and installed file hashes against the archive; exact peers; every
`node_modules/.bin` symlink and help path; imports or registration; both
typecheck runs; the root declaration closure; and `npm ci` replay of the retained
lockfile from another empty cache with an identical lockfile and graph.

Observations in every run:

- **Archive.** 1,162 regular members under `package/`, no links, the Unicode
  module with its license text, both binaries, all three exports with
  declarations, the Linux bootstrap and the bundled bridge. No
  `docs/superpowers/`, `evidence/`, `test/`, `src/` or `scripts/` member.
- **Base consumer.** Exact Pi 1.0.2 and no Pi Durable anywhere in the tree. Root
  and coding-resource imports succeed, a deep `dist/` import is refused with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`, and `@chio/pi-plugin/durable` fails with
  `ERR_MODULE_NOT_FOUND` for `@earendil-works/pi-durable`.
- **Durable consumer.** Exact Pi 1.0.2 and Pi Durable 1.0.2. The registration
  smoke opens a real `Harness` over `MemoryStorage` and installs two tools, both
  `replay: "unsafe"` and sequential, with zero executor calls, lookups or
  acknowledgements and a written `store-owner.binding`.
- **Executables.** `chio-coding-resource`, `chio-pi`, `pi` and `tsc` are npm
  symlinks inside the installation; each `--help`, and `chio-pi doctor`,
  `status`, `inspect` and `recover --help`, exits 0 with output.
- **Typecheck.** TypeScript 7.0.2 with `@types/node` 26.5.0, NodeNext and strict.
  With `skipLibCheck: false`, tsc reports 45 diagnostics, none in this package's
  declarations or the consumer file: 42 TS1543 JSON import attributes in Pi's
  `pi-ai` declarations, one TS2694 `path.PlatformPath` in Pi's `find.d.ts`, and
  two TS2307 in nested `@google/genai` and `gaxios` declarations. The ordinary
  `skipLibCheck: true` build exits 0. The root and coding-resource declaration
  closure references only `@chio/bridge`, `@earendil-works/pi-coding-agent`,
  `node:child_process` and `node:fs`.
- **Isolation.** Each consumer has its own empty npm cache, `HOME` and
  `PI_CODING_AGENT_DIR`, and an allowlisted environment with no provider, kernel
  or registry credential. The normal `~/.pi` profile's metadata digest (11
  entries) was identical before and after each run.

npm 10.9.3 and npm 11.8.0 resolved different graphs: npm 10.9.3 adds a nested
`@types/node@26.6.4` and `undici-types@8.9.0` under Pi's transitive `protobufjs`.
npm 11.8.0 produced byte-identical lockfiles under Node 25.5.0 and 22.19.0.

Dry-run publication with Homebrew Node 25.5.0 and an isolated `HOME` and cache:

```sh
npm publish /tmp/chio-pi-roadmap-release/chio-pi-plugin-0.2.0.tgz --dry-run --ignore-scripts --access public
```

Exit 0, 1,162 files, matching integrity, with npm's expected not-logged-in
warning. Nothing was published.

## Minimum Node 22.19.0

The package itself was verified with official Node 22.19.0 rather than inferred:
both consumers passed with its bundled npm 10.9.3 and with npm 11.8.0, including
imports, every help path, the Durable registration smoke and `npm ci` replay.

The source component suite also ran with official Node 22.19.0, npm 10.9.3:

```sh
npm run typecheck && npm test
```

The first run passed **389 of 394**. Four failures were the macOS runtime-closure
fixtures (`missing`, `incomplete`, `wrong hash`, `extra`), which assert
`recipe.runtimeFiles.length > 1`: they need a Node linked against non-system
dylibs, such as Homebrew's, and official builds link only system libraries. The
fifth was the recorded `guest-termination` `kill EPERM` flake. That file then
passed 3 of 3 in five isolated runs, and a full rerun passed **390 of 394** with
only the four fixture prerequisites failing, in 100.5 s. These four are test
prerequisites, not product refusals.

## Defects found and fixed

**Installed `chio-coding-resource` did nothing.** The first cold consumer showed
`chio-coding-resource --help` exiting 0 with empty output. Its main guard compared
the npm symlink path with the module URL, so every command through the installed
binary, including `serve`, exited silently. A new regression running `--help` and
`inspect` through a symlink failed with empty output, then passed after the guard
compared real paths, as `chio-pi` already does. Coding-resource tests: 71 of 71.

**macOS recipe policy granted unrestricted metadata.** With official Node 22.19.0
the existing real sandbox probe failed. A diagnostic run identified
`stat allowed: .../fixture-credential.json`; Node 26.7.0 failed identically and
Homebrew Node 25.5.0 passed. File contents stayed denied. With no non-system
dylib aliases the generated Seatbelt policy contained `(allow file-read-metadata )`,
an allow rule without a filter, which matches every path. The earlier records
attributed this failure under Node 26.7.0 to the missing dylib closure. A new
policy regression failed on the unfiltered rule before the fix. The rule is now
emitted only when aliases exist; policies with aliases are byte-identical. After
the fix the real probe passes with Node 22.19.0, 26.7.0 and 25.5.0, and the
confinement file passes 13 of 13 with Homebrew Node 25.5.0.

The first candidate, `63d421be29ca45ef524fda997063200ab5645560b28b31fdd6159bb25a3e5f30`
from `1e611c5`, passed the 393-test suite with Homebrew Node 25.5.0 and both
consumers on all three toolchains. It is superseded, not relabeled: the policy fix
changed source, so the candidate was rebuilt and every check above was repeated.

## Reproducibility

The same commit packed with official Node 22.19.0 and npm 11.8.0, and again with
npm 10.9.3, produced `058701ee7b48d5b2025265d4f5e713e68606205e9e1eda5e0c360ca6fefef657`.
Its uncompressed tar is identical to the candidate of record's,
`06c09466232be95d47d592ff1c6d1a9eaeb9bf9c05d3a4a11bc424cf31d9fe9b`; only gzip
output differs, between Homebrew Node's system zlib 1.2.12 and Node 22's bundled
zlib 1.3.1. That rebuild also passed both consumers with Node 22.19.0 and npm
11.8.0. An archive's identity therefore includes its builder's compression
library; hosted CI on Linux x64 will produce its own identity.

The repack with this record and the retained consumer evidence present,
uncommitted, produced `0701bfc7c689424628df96988f890b37bcbdf7b888e8ec1307411982d1d45b3b`,
identical to the candidate of record.

## Retained evidence

[evidence/2026-10-05/release-candidate-0.2.0/](../../../evidence/2026-10-05/release-candidate-0.2.0/README.md)
holds the builder-lock provenance and archive manifest, and for each toolchain the
actual consumer `package.json`, `package-lock.json`, resolved graph and separate
consumer provenance. Consumer fixtures use the relative archive dependency. No
retained file contains a host-specific absolute path or credential.

## CI

`ci.yml` and `release.yml` now run `scripts/qualify-release.mjs` for both
consumers with Node 22.19.0 and npm 11.8.0, keep `npm publish --dry-run`, and
retain the consumer evidence as `consumer-evidence`. The exact-source CI and
publisher environment checks and the tag-gated publish job are unchanged.
`actionlint` passed on both files. Hosted runs have not happened; Task 8 reports
them from the live PR.

## Qualified and not qualified

Qualified here: the `0.2.0` archive's contents, staged metadata, installation
from an empty cache with exact Pi 1.0.2 with and without exact Pi Durable 1.0.2,
binaries, imports, declarations, Durable registration and lockfile replay, on
macOS arm64 with Node 25.5.0 and Node 22.19.0.

Not qualified: any native kernel, provider, P2 to P5 service or native coding
workflow; real-host I01 to I08 on Pi 1.0.2; Linux or x64 consumer installation,
which hosted CI is expected to exercise; Windows; publication. The frozen
`0.1.0` qualification does not transfer to this candidate.
