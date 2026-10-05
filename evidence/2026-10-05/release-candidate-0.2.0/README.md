# Release candidate 0.2.0 cold consumer evidence

**Superseded.** This pre-review candidate (`0701bfc7...`, built from unreviewed
source commit `2059150`) is not the candidate of record. The candidate of record
is packed from the final reviewed commit; see
[release-candidate-0.2.0-final](../release-candidate-0.2.0-final/README.md). In
Task 8 the `package-lock.json` and `resolved-graph.json` files of
`node-25.5.0-npm-11.8.0/` were removed because they were byte-identical to those
of `node-22.19.0-npm-11.8.0/`, which keeps the full set. Their
`consumer-provenance.json` files still record both digests, and the run's
`package.json` files and `summary.json` remain. The rest of this record is
unchanged.

Retained by Task 7 of the full roadmap on 2026-10-05, macOS 26.4 arm64
(Darwin 25.4.0). The record is
[docs/superpowers/evidence/2026-10-04-task7-release.md](../../../docs/superpowers/evidence/2026-10-04-task7-release.md).
These files are installation and packaging evidence only. No kernel, provider,
credential or protected execution was involved.

The candidate is `chio-pi-plugin-0.2.0.tgz`, SHA-256
`0701bfc7c689424628df96988f890b37bcbdf7b888e8ec1307411982d1d45b3b`, packed by
`scripts/pack-release.mjs` from clean source commit
`2059150620d654093cddbca1f100630d175394be` with Homebrew Node 25.5.0 and npm
11.8.0. The archive itself is not committed. This directory is outside the
packaged `files` selection, so retaining it does not change the archive.

| Path | Record |
| --- | --- |
| `builder/` | Builder-lock provenance from the packer, the artifact checksum line and the archive member manifest with per-file SHA-256. |
| `node-25.5.0-npm-11.8.0/` | Consumers run with Homebrew Node 25.5.0 and its npm 11.8.0. Lockfiles and graphs removed as duplicates; digests retained. |
| `node-22.19.0-npm-10.9.3/` | Minimum Node: official nodejs.org Node 22.19.0 with its bundled npm 10.9.3. |
| `node-22.19.0-npm-11.8.0/` | Minimum Node with the release toolchain's npm 11.8.0. |
| `rebuild-node-22.19.0-npm-11.8.0/` | Builder provenance and consumer summary for the same commit packed with Node 22.19.0 and npm 11.8.0. |

Each run directory holds `summary.json` and one directory per consumer:
`consumer-base` (exact Pi 1.0.2, no Pi Durable) and `consumer-durable` (exact Pi
1.0.2 and Pi Durable 1.0.2). A consumer directory retains the actual
`package.json` and `package-lock.json` written by npm, the `npm ls --all --json`
graph and `consumer-provenance.json`, which is the consumer-lock record: lockfile
and graph digests, artifact SHA-256, source commit, Node, npm and platform
identities, installation commands, environment keys and every check result.
Builder and consumer provenance are separate records.

Every consumer depends on the archive through the relative
`file:../chio-pi-plugin-0.2.0.tgz`. The only absolute path `npm ls` reports, the
local archive URL, is retained as that same relative dependency and counted in
`resolvedGraphNormalization`. To replay a consumer, copy its run directory to a
scratch location, place the verified archive beside the consumer directories,
and run from the consumer directory with an empty cache:

```sh
npm ci --ignore-scripts --install-strategy=nested --no-audit --no-fund
```

Lockfiles written by npm 10.9.3 and npm 11.8.0 differ: npm 10.9.3 installs an
extra nested `@types/node` for a Pi transitive dependency. Exact peers do not
freeze Pi's transitive graph; the consumer lockfile does.
