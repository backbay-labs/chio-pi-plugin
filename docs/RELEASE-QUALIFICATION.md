# Release qualification

This lane builds `@chio-protocol/pi-plugin` from one immutable source commit. A passing workflow
qualifies its source checks and installable package. It does not establish
real-host I01-I08 acceptance, a compatible public kernel, or six-host completion.

## Current boundary

- Package version: `0.2.0` candidate. The frozen `0.1.0` archive, named
  `@chio/pi-plugin` (published name `@chio-protocol/pi-plugin` from 0.2.0), and its
  hashes remain the scope of [FINAL-QUALIFICATION.md](FINAL-QUALIFICATION.md).
  Existing local candidate tarball hashes do not identify newly rebuilt
  archives, including metadata-only rebuilds.
- Public repository identity: `backbay-labs/chio-pi-plugin`.
- Workflow: `.github/workflows/release.yml`.
- Registry package: `@chio-protocol/pi-plugin`; GitHub environment: `npm`.
  The [publishing guide](PUBLISHING.md) covers the one-time npm bootstrap.
- Release tags: `v<package.json version>`, reachable from `main`.
- Manual `workflow_dispatch` always builds, tests, packs, qualifies the base
  and Durable cold consumers, and generates provenance. It never publishes to npm or
  creates a GitHub Release. There is no manual publish switch.
- Source CI, real-host acceptance, kernel qualification, and any repository
  rulesets remain separate gates. Do not treat package checks as replacements.

The release build uses Node 22.19.0, npm 11.8.0, `npm ci --ignore-scripts`, mandatory build and
unit checks, and `npm run pack:release`. TypeScript packages also require a
successful typecheck. It builds from this checkout and its checked-in vendored
archives; no private sibling checkouts or placeholder actions are used. The
staged tarball embeds the Chio dependencies and removes lifecycle scripts.

## Local qualification

Use a clean isolated checkout and a new artifact directory. Never overwrite a
frozen acceptance bundle. From `.`:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run build
npm test
npm run pack:release -- /absolute/new-candidate-directory
```

Qualify the resulting tarball in two fresh consumers, then dry-run publication:

```sh
node scripts/qualify-release.mjs --release /absolute/new-candidate-directory \
  --work /absolute/new-scratch-directory --evidence /absolute/new-evidence-directory
npm publish /absolute/new-candidate-directory/package.tgz --dry-run --ignore-scripts --access public
```

The filename `package.tgz` above is a placeholder for the emitted tarball. The
consumer command performs the manual steps below for both consumers, with
separate empty caches and an isolated home and Pi profile for each. It runs
every check in [candidate 0.2.0](#candidate-020) and refuses existing work or
evidence directories. The equivalent manual base consumer, from a new empty
directory `chio-pi` beside a copy of the tarball, is:

```sh
export npm_config_cache=/absolute/new-empty-cache
npm install ../package.tgz @earendil-works/pi-coding-agent@1.0.2
npx chio-pi --help
npx chio-coding-resource --help
```

This is the [README](../README.md#build-and-install) command with the archive in
place of the registry name: npm's default install strategy and lifecycle scripts,
with no ordering, save or script flags. The Durable consumer adds
`@earendil-works/pi-durable@1.0.2` to the same command. Before installing, the
consumer command confirms that the empty directory is its own npm prefix, since
npm otherwise installs into a parent that has a `package.json` or `node_modules`.
It then adds exact TypeScript tooling with
`npm install --save-dev --save-exact typescript@7.0.2 @types/node@26.5.0` for the
consumer typecheck. Executing installed help catches missing peer transitive
dependencies even when npm exits successfully. Registry access is required for
the host and the public TypeBox and Ajv dependencies; Chio dependencies are
bundled. The peer-first, nested procedure recorded for earlier candidates is not
needed with Pi 1.0.2.

## Candidate 0.2.0

The `0.2.0` candidate carries the roadmap surface mapped in the
[implementation crosswalk](ROADMAP-IMPLEMENTATION.md). Pack it from a clean,
reviewed commit. The packer removes and rebuilds `dist/` from source, and refuses
any change to `package.json` or `package-lock.json` while packing. It writes the
archive, its SHA-256 file and a builder provenance record.

The archive contains both binaries (`chio-pi` and `chio-coding-resource`), the
`.`, `./coding-resource` and `./durable` exports with their declarations, the
Linux guest bootstrap, the generated Unicode 15.1 module with its complete
Unicode License V3 text, the bundled `@chio/bridge@0.3.0` from vendor archive
`7d9e34f7408a...` with its production dependencies, `README.md`, `LICENSE`, the
user documentation under `docs/` and the vendored bridge archives. The staged
manifest keeps exact `ajv` and `typebox` registry dependencies, exact peers
`@earendil-works/pi-coding-agent@1.0.2` and optional
`@earendil-works/pi-durable@1.0.2`, `engines.node >=22.19.0`, and no scripts or
development dependencies.

The archive excludes `docs/superpowers/`: plans, specifications and task
evidence, including machine-readable results that contain local temporary paths.
Task evidence records candidate and consumer hashes. Shipping it would make
every evidence commit change the candidate it describes. Retained consumer
provenance likewise lives outside packaged paths, under `evidence/`. With both
outside the archive, a later evidence-only commit rebuilds the same bytes.

Builder and consumer provenance are separate records:

- **Builder provenance** (`ARTIFACT.provenance.json` from the packer): source
  commit and dirty flag, artifact SHA-256 and npm integrity, builder
  `package-lock.json` SHA-256, bridge archive SHA-256, bundled package versions,
  registry dependency versions with lock integrity, exact peers, exports, bins,
  engines, and the builder's Node, npm and platform.
- **Consumer provenance** (`consumer-provenance.json`, one per consumer): the
  actual consumer `package.json` and `package-lock.json` with its SHA-256, the
  resolved `npm ls --all` graph, artifact SHA-256, source commit, Node, npm and
  platform identities, exact installation commands and every check result. The
  consumer depends on the archive through `file:../ARTIFACT.tgz`, never through
  a temporary absolute path. Exact peers alone do not freeze Pi's transitive
  graph; the consumer lockfile does.

`scripts/qualify-release.mjs` creates two consumers, each with an empty npm
cache, an isolated `HOME` and `PI_CODING_AGENT_DIR`, and an environment allowlist
that carries no provider or registry credentials:

- **Base consumer:** exact Pi 1.0.2 and no Pi Durable anywhere in the tree. It
  imports the root and coding-resource entrypoints, observes that the Durable
  entrypoint requires its optional peer, and typechecks a consumer of the root
  and coding-resource declarations.
- **Durable consumer:** exact Pi 1.0.2 and exact Pi Durable 1.0.2. It imports and
  typechecks the Durable entrypoint. Its registration smoke opens a real Durable
  `Harness` over `MemoryStorage` and installs `createChioDurableTools` with one
  `replay: "unsafe"`, sequential tool per pinned tool, without executing,
  looking up or acknowledging any operation.

Both consumers check the archive members and exclusions, staged metadata,
installed file hashes against the archive, export and binary containment,
refusal of non-exported deep imports, and the exact peers. Every
`node_modules/.bin` entry must be a symlink inside the installation. Each
executable that a direct consumer dependency declares (the two Chio binaries,
`pi` and TypeScript's `tsc`) must exit 0 with output for `--help` when run through
that symlink, as must `chio-pi doctor|status|inspect|recover --help`. npm's
default strategy also hoists transitive executables; those are checked for
containment only, and consumer provenance lists them with any packages that
carry install scripts. Typechecking runs twice. With
`skipLibCheck: false`, no diagnostic may fall in this package's declarations or
the consumer file; upstream Pi diagnostics are recorded. The ordinary
`skipLibCheck: true` consumer build must pass. The root declaration closure must
not reference Pi Durable. Each retained lockfile is then replayed with `npm ci`
from another empty cache and must reproduce the same lockfile and graph. The
normal Pi profile's metadata must be unchanged, and retained evidence must hold
no host-specific absolute path.

The command uses the Node running it and the npm installed beside that Node.
Verify the minimum supported Node by running it with Node 22.19.0 itself.

CI runs the same command with Node 22.19.0 and npm 11.8.0 after typecheck, build
and tests, checks that the packed manifest names `@chio-protocol/pi-plugin`, then
performs only `npm publish --dry-run`. It retains the packed
candidate as `source-package` and the consumer evidence as `consumer-evidence`.
In the release workflow, the build job runs the same consumer qualification after
its tag-build prerequisite check and before provenance generation and the separate
publication job, whose existing gates are unchanged. In both workflows the consumer
evidence upload fails only when qualification succeeded but left no evidence; an
earlier failure uploads any partial evidence without a second failing step.

The local candidate of record is packed from the final reviewed commit of the
roadmap branch. Its archive SHA-256, source commit, builder provenance and
consumer lockfile digests are in the
[Task 8 final verification record](superpowers/evidence/2026-10-05-task8-final-review-fixes.md#final-verification)
and under `evidence/2026-10-05/release-candidate-0.2.0-final/` in the source
repository. This guide ships in the archive, so it does not repeat the hash;
naming it here would change the archive it names. The pre-review candidate
`0701bfc7...` from `2059150`, recorded in the
[Task 7 release record](superpowers/evidence/2026-10-04-task7-release.md), is
superseded. Both records predate the rename to `@chio-protocol/pi-plugin`, so
their archives carry the earlier name. The rename changes the archive bytes; the
published 0.2.0 is identified by the digest its release workflow run records.

## Hosted qualification and publication

1. Commit source, package metadata, and evidence in their owning repository.
   Preserve the exact kernel, plugin, bridge, SDK, policy, and host identities.
2. Observe required repository checks on the candidate. Run this workflow
   manually at that exact ref and retain `qualified-package` plus
   `package.intoto.jsonl`. A skipped real-host case remains unresolved.
3. Complete all applicable I01-I08 acceptance and the compatible kernel's
   release/security gates before approving production delivery. The original
   unsigned kernel 0.1.0 is not evidence for the new candidate.
4. Configure the `npm` environment before tagging and preserve existing
   repository protection rules. Verify exact commit, kernel compatibility and
   acceptance records under the applicable release procedures. This workflow
   does not require adding human reviewers or changing protection rules.
5. An npm maintainer must register this package's Trusted Publisher with GitHub
   owner `backbay-labs`, repository `chio-pi-plugin`, workflow filename `release.yml`,
   and environment `npm`. Permit direct `npm publish` for this workflow. Do not
   configure a stored `NPM_TOKEN` fallback or print authentication files. npm
   accepts a Trusted Publisher only for a package that already exists, so the
   first version is published once by hand as described in [publishing](PUBLISHING.md).
6. Only after those gates, create a new annotated version tag from reviewed
   `main`. A tag push can publish. The workflow rejects tag/version mismatch,
   a source commit outside `main`, and a mismatched `repository.url`.
7. The publication job downloads the built bytes, verifies SLSA provenance and
   checksums, checks that the archive manifest carries the bound package name and
   version, signs the checksum index, verifies its exact GitHub workflow
   identity, then publishes that same tarball with npm OIDC provenance. It
   requires npm 11.5.1 and Node 22.14.0 or later and uses no `NODE_AUTH_TOKEN`. A
   prerelease version uses npm's `next` dist-tag. Stable versions use `latest`.
8. Verify the public tarball and GitHub Release assets independently, install
   from the documented public path in a new profile, and repeat the supported
   useful-work and prevention/recovery smoke cases against the qualified kernel.

Ordinary actions use full commit pins. The SLSA generator is the documented
exception: upstream requires the exact release tag `v2.1.0` for standard
`slsa-verifier` compatibility. Before using it, the build checks that the tag
resolves to `f7dd8c54c2067bafc12ca7a55595d5ee9b75204a`. The generator runs as a
separate reusable workflow and must pass before publication. No SLSA level or
reproducibility claim is established by the presence of this YAML alone.

## Verify and recover

The GitHub Release contains the tarball, `release-identity.json`, `SHA256SUMS`,
its `.sig` and `.pem`, and `package.intoto.jsonl`. Pin the intended repository,
tag, source commit, and expected checksums before trusting the package:

```sh
sha256sum --check SHA256SUMS
cosign verify-blob --certificate SHA256SUMS.pem --signature SHA256SUMS.sig \
  --certificate-identity 'https://github.com/backbay-labs/chio-pi-plugin/.github/workflows/release.yml@refs/tags/v0.2.0' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com SHA256SUMS
slsa-verifier verify-artifact package.tgz \
  --provenance-path package.intoto.jsonl \
  --source-uri github.com/backbay-labs/chio-pi-plugin --source-tag 'v0.2.0'
```

A timeout or failure after npm publication can leave a published version without
all GitHub assets. Inspect registry `dist.integrity`, retained
`publication-evidence`, and release assets before retrying anything. Compare the
published bytes with the qualified digest; never repack and overwrite a version
or replace conflicting release assets. If the package already exists with the
expected bytes, recover only missing GitHub assets after review. If a defective
package escaped, deprecate it and release a new version. Preserve evidence of the
failed attempt. Roll users back only to a compatible previously qualified
kernel/plugin set; do not silently select the old CLI by its ambiguous version.

## Unresolved external setup

The 2026-09-09 audit observed GitHub ADMIN access for existing Chio integration
repositories. That does not establish npm ownership or Trusted Publisher trust.
No production environment protections or npm Trusted Publisher configuration
were changed while preparing this workflow. Hosted execution, publication,
registry verification, and final host acceptance remain unperformed by this
workflow change.

References: [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/),
[GitHub secure action use](https://docs.github.com/en/actions/reference/security/secure-use),
[SLSA generator contract](https://github.com/slsa-framework/slsa-github-generator/blob/v2.1.0/internal/builders/generic/README.md).

Pi has no configured Git remote, and `backbay-labs/chio-pi-plugin` was not visible
to the authenticated GitHub account at audit time. Its metadata records the
intended owner consistently, but repository creation/owner confirmation and
Trusted Publisher setup remain external inputs before hosted execution.

## Verification of this workflow change

This section records the September 2026 verification of the 0.1.0 workflow
change. The 0.2.0 candidate's checks are in [candidate 0.2.0](#candidate-020).

Local execution used Node 22.19.0 and npm 11.8.0 in an isolated checkout. The
workflow's locked dependency install with scripts disabled, build/type checks,
and 23 unit tests passed with zero failed or skipped tests. Staged packing,
a new consumer directory with an empty cache, entrypoint checks, and
`npm publish --dry-run` passed. `actionlint` passed. The source identity check
accepted the intended identity and rejected a different package, repository,
tag, and invalid version. These are local package and workflow checks; hosted
OIDC signing, SLSA verification, npm publication, and real-host acceptance are
not claimed by these results.

## Source CI

`.github/workflows/ci.yml` uses pinned actions, this checkout's locked and
vendored dependencies, mandatory source checks, and the same staged packaging
and cold-consumer command exercised locally. It retains the candidate and the
consumer evidence as workflow artifacts. Existing workflow/job check names
are retained. No typecheck failure is downgraded to a warning, no real-host test
is reported successful because credentials are absent, and no legacy normal-home
smoke cleanup is executed. CI does not publish.

### Enforced promotion prerequisites

A tag build fails before publication unless the `npm` environment exists and the latest `ci.yml` push run on
`main` for the exact tag commit is completed successfully. The publication job
checks both conditions again when the configured environment permits the job. Missing API access,
missing environment configuration, pending, skipped, cancelled or failed CI is a
release failure. Configure the environment before creating a release tag; a
workflow reference alone can otherwise create an environment implicitly. Existing
protection rules remain enforced by GitHub; this workflow does not require adding
reviewers or changing them.

These checks enforce this repository's source/package CI and configured environment boundary.
They do not establish kernel security or any host acceptance gate. Release
qualification must separately verify the selected kernel's exact-source CI and Release
Qualification, immutable artifact identity, and all applicable I01-I08 evidence.
The workflow does not publish on manual dispatch. No environment or repository
setting was changed by this local workflow repair.

The source build was also rerun from tracked files in an independent temporary
checkout with an initially empty npm cache and no sibling repositories. Locked
installation, build, and staged packaging passed. Vendored Chio archives are
tracked Git inputs with lockfile integrity; they are not private local caches.
Pi uses an independent Git clone because its packer records the source commit
and correctly rejects a source tree with no Git identity. All six promotion
workflow files pass `actionlint`; negative tests reject an absent or mismatched environment,
missing CI, another source commit, pending CI, and failed CI. These local tests
do not assert that hosted CI has run or that publisher settings exist.
