# Release candidate 0.2.0 final cold consumer evidence

Retained by Task 8 of the full roadmap on 2026-10-05, macOS 26.4 arm64
(Darwin 25.4.0). The record is the "Final verification" section of
[docs/superpowers/evidence/2026-10-05-task8-final-review-fixes.md](../../../docs/superpowers/evidence/2026-10-05-task8-final-review-fixes.md#final-verification).
These files are installation and packaging evidence only. No kernel, provider,
credential or protected execution was involved.

This is the candidate of record. It is `chio-pi-plugin-0.2.0.tgz`, SHA-256
`ca4bb45f7a333ca890c6243eeed935e6083454433e3a1f49b6531fa3b7b8ab51`, 5,811,862
bytes with 1,164 files, packed by `scripts/pack-release.mjs` from clean source
commit `c5b94a5932204849c6b11d9e9415ac29dd1060a3`, the final reviewed commit,
with Homebrew Node 25.5.0 and npm 11.8.0. The archive itself is not committed.
This directory is outside the packaged `files` selection, so retaining it does
not change the archive. The earlier pre-review candidate in
[release-candidate-0.2.0](../release-candidate-0.2.0/README.md) is superseded.

| Path | Record |
| --- | --- |
| `builder/` | Builder-lock provenance from the packer, the artifact checksum line and the archive member manifest with per-file SHA-256. |
| `node-22.19.0-npm-11.8.0/` | Full consumer fixture set with the CI release toolchain: official nodejs.org Node 22.19.0, the minimum supported Node, with npm 11.8.0. |
| `node-25.5.0-npm-11.8.0/` | Homebrew Node 25.5.0 and its npm 11.8.0: summary, consumer `package.json` and consumer provenance with lockfile and graph digests. |

Each run directory holds `summary.json` and one directory per consumer:
`consumer-base` (exact Pi 1.0.2, no Pi Durable) and `consumer-durable` (exact Pi
1.0.2 and Pi Durable 1.0.2). `consumer-provenance.json` is the consumer-lock
record: lockfile and graph digests, artifact SHA-256, source commit, Node, npm
and platform identities, installation commands, environment keys and every
check result. Builder and consumer provenance are separate records.

Both toolchains wrote byte-identical lockfiles and resolved graphs, so only the
Node 22.19.0 set keeps them in full:

| Consumer | Lockfile SHA-256 | Resolved graph SHA-256 |
| --- | --- | --- |
| Base | `b5a8b3108d02bf5e426fe19a5b53d4540abef34997eaf171cdae1002d470fb50` | `339ec9af80932215cea66084bda0b0c0893240ed9bdbdd56b353413b8c2c2d3c` |
| Durable | `339644dc9e2bdd9f5e12b14591786f8f3023a8d153d73c72690390e1d7197b97` | `4705a3382d3a8f2cff3981af7084f3176470286341d35bd2081392881c2d85de` |

Every consumer depends on the archive through the relative
`file:../chio-pi-plugin-0.2.0.tgz`. The one absolute local archive URL that
`npm ls` reports is retained as that same relative dependency, as each
`resolvedGraphNormalization` records. To replay a consumer, copy
`node-22.19.0-npm-11.8.0/` to a scratch location, place the verified archive
beside the consumer directories, and run from the consumer directory with an
empty cache:

```sh
npm ci --ignore-scripts --install-strategy=nested --no-audit --no-fund
```
