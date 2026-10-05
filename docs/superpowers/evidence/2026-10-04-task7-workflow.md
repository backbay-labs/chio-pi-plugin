# Task 7a: Development workflow fixture and roadmap qualification command

Scope: the first part of Task 7 of the authorized full roadmap, on
`feat/pi-full-roadmap-20261004`, starting from reviewed `3eae77f`. The code commit
is `70a228a` (`test: qualify Chio Pi development workflow`). README and crosswalk
documentation, version `0.2.0`, release packing, cold consumers and CI belong to
Task 7b and are not part of this change. The primary checkout, frozen bridge,
operator and qualification artifacts and all earlier evidence are unchanged.
No production source under `src/` changed.

Confidence: high for the signed bridge fixture contracts and the measured local
recipe confinement listed below. Native coding-workflow acceptance stays open.

## Evidence layers

Every test name, helper label and result field states its layer:

- **Signed bridge fixture.** A scripted kernel signs outcomes with an ephemeral
  fixture key and forwards each admitted call to the real `chio-coding-resource`
  participant on its kernel-owned stdio pipe. Calls travel through the bundled
  native gateway, the trusted parent proxy, the guest adapter and actual Pi
  Durable hosts. This measures adapter and host contracts. It does not qualify a
  real kernel or authority installation. The fixture admission identity is
  `sha256(native request ID)`, a fixture convention.
- **Real local confinement.** Both recipe runs execute the operator-pinned recipe
  under `sandbox-exec` on macOS and bubblewrap in the pinned Linux image. This is
  not whole-Pi confinement, P5 acceptance or an ordinary Docker default.
- **Retained completed tool error.** Forbidden access is refused by the resource
  before effects and delivered as a completed tool error with an `allow` verdict.
  It is not a native signed denial, which would keep its native fence.
- **Unknown original.** When the resource commits a publication before native
  completion evidence is retained, the original stays unknown and fenced. The
  unsigned resource ledger reports the completed publication but cannot clear
  the native fence, and no replacement publication is dispatched.
- **Native kernel.** Open. The exact kernel, publisher manifest, custody/launch
  profile, caller binding and signed recovery fixture in
  [native prerequisites](../../NATIVE-PREREQUISITES.md) are not available here.

## Implemented workflow

`test/helpers/roadmap-workflow.mjs` reuses the Task 3 coding fixture and stdio
driver, the Task 4 native fixture (extended with an optional scripted dispatch,
tool inventory and kernel timeout; existing defaults unchanged), the parent
proxy, `gatewayExecutor`, `createChioDurableTools`, continuation export/import
and `bindRecovery`. The imported source has `isExpired(now, deadline)` returning
`now > deadline` and a single-process `node:test` recipe with three cases.

1. `repo_status`, `search` for `export function isExpired` and `read_range`
   locate and read the source through admitted tools.
2. The first `test_recipe` run fails only `isExpired is true at the exact
   deadline` (2 pass, 1 fail) in real confinement. The workflow stops with
   `bug-not-demonstrated` if this does not happen.
3. `read_range` of `../operator.json` is refused as `invalid_path`, and publishing
   the failing lineage is refused as `lineage_mismatch`. Both are delivered, leave
   no native fence and create no artifact.
4. Under the same capability, subject, caller digest, authority digest and
   registry digest, `apply_patch` performs a full-file CAS literal edit, the same
   pinned recipe passes, and `repo_diff` is reviewed against the intended single
   edit before publication. A failed test or unexpected diff stops the workflow
   without publishing.
5. `publish_artifact` binds the exact source, test operation, test result,
   recipe and the `review` destination. The host response is discarded after the
   native gateway retained the signed completion. The first host is unresolved.
6. The handoff is exported, the first host and parent proxy close and the native
   gateway restarts. A second actual Pi Durable host imports the handoff, binds
   recovery to the original identity and commits the exact original outcome. Its
   executor is never called; no kernel call or resource dispatch occurs; one
   original ACK clears the fence.
7. A second scenario discards the scripted kernel completion after the resource
   committed the publication. The original is unknown, second-host recovery is
   refused, a replacement publication is refused by the parent fence (`native
   original or parent reservation remains fenced; no fresh effect`), and the
   artifact store still holds exactly one publication.

An independent observer reads the artifact root, import root and immutable
generations directly, and watches the artifact root. It counts distinct
content-addressed publications, checks inode and mtime stability across
recovery, decodes the bundled source and compares bindings.

Each step waits for its own original's native record and parent mapping to show
delivery through the adapter's commit observer, bounded at 60 s, then falls back
to the documented `flush()` wait and re-checks. Every step in the retained
results was delivered by the commit observer.

## Qualification command

`scripts/qualify-roadmap.mjs` runs both scenarios and its own independent
checks: signed outcomes are verified with the bundled `verifyCompletedOutcome`
against the native journal; recipe digests are recomputed from the operator
configuration; test result digests are recomputed; the bundle, diff and source
are compared with the import original. It writes a machine-readable result,
never replaces an existing result file, and exits 0 passed, 1 failed (evidence
preserved), 2 usage or precondition, 3 refused. It refuses when real local
confinement is unavailable. `--profile native` is refused without a substitute
run: without a profile it lists all six prerequisites as missing, a mismatched
pinned hash is reported missing, and a complete profile is still refused as
`nativeAcceptanceRunner` because this candidate ships no native acceptance runner.

## RED and GREEN record

macOS 26.4 arm64. Unless noted, commands ran with Homebrew Node 25.5.0 at
`/opt/homebrew/Cellar/node/25.5.0/bin/node` (SHA256
`dd15588a84f33431b4e616b04a2d0f79be676b1d537a43f0537a62279c592d21`), npm 11.8.0,
first on `PATH`.

- Test file before the helper and command existed:
  `node --test --test-reporter=tap test/roadmap-workflow.test.mjs` reported
  0 pass, 1 fail with `ERR_MODULE_NOT_FOUND` for the helper.
- The first confined recipe run demonstrated the bug:
  `✖ isExpired is true at the exact deadline`, `false !== true`, `pass 2`,
  `fail 1`, exit code 1, sandbox `seatbelt`.
- First GREEN of the recovery test: 1 pass in 114.0 s. Profiling showed 262
  native operator status calls and Ajv code generation dominating, caused by
  `flush()` re-observing every retained intent after each step. The bounded
  per-original delivery wait reduced a run to about 49 s with 82 status calls.
- Self-review RED: the command's signed-step check required at least 10 steps;
  the workflow has 9 admitted steps before publication. It now requires exactly
  9, and the recovery test passed.
- Mutation REDs, each restored afterwards: importing already fixed source made
  the recovery test fail with status `bug-not-demonstrated` and no patch or
  publication; removing `bindRecovery` made it fail with `recovery-failed`
  because the receiving host's fresh dispatch met the native fence.

## Verification

At `70a228a`, clean worktree, Homebrew Node 25.5.0:

```sh
npm run typecheck
npm test
node scripts/qualify-roadmap.mjs --profile component --out RESULT.json
```

Typecheck exited 0. `npm test` passed **384 of 384** tests (381 earlier plus 3
new) with zero failures, cancellations or skips in 117.8 s; the same 384 also
passed on the final bytes before commit in 98.8 s. The command exited 0 in
72.0 s with 21 of 21 independent checks passed, `sourceCommit`
`70a228a430925da229529921e388e2e2e7f1777b` and
`worktreeDirty: false`. Its exact output is retained as
[2026-10-04-task7-workflow-result.json](2026-10-04-task7-workflow-result.json),
SHA256 `1dad87f0b7e6faaf2b3ccfc42f483011bef4f9295dba80c0c446a9a77287839c`.
Source digests are deterministic: initial
`aad9a555e054359b88a1e89e7aea0974035d79b82a55e53ec358a9a2bb688d08`, patched
`fc34f6fa3bc9aef8cb5d62d3689400a5422c76aca21ebb3f1714ac03fbff909f`. Artifact and
test result digests include recipe timing output and differ between runs.

The host default `node` is v26.7.0 (`/Users/connor/.local/bin/node`, resolving to
`/Users/connor/.hermes/node/bin/node`). With it,
`node --test test/roadmap-workflow.test.mjs` passed 3 of 3. Its five existing
`coding-confinement` runtime-closure failures are unrelated and unchanged.

Linux used the pinned image
`sha256:6d5bbc54ae9fd29177042755c41667006b708874c7ed6d489d543e931e33fe23`
(Node 22.23.1, bubblewrap 0.8.0, arm64, Colima VM) in a disposable
`docker run --rm --privileged --network none` container with the worktree
mounted read-only. The privileged outer container is needed for nested
namespaces on this VM; it does not qualify ordinary Docker defaults or P5.

```sh
docker run --rm --privileged --network none \
  --mount type=bind,source=WORKTREE,target=/opt/chio-plugin,readonly \
  --workdir /opt/chio-plugin \
  sha256:6d5bbc54ae9fd29177042755c41667006b708874c7ed6d489d543e931e33fe23 \
  node test/helpers/coding-linux-runner.mjs test/roadmap-workflow.test.mjs
```

The runner now accepts explicit repository test files; its default selection is
unchanged. At `70a228a` the workflow file passed **3 of 3** in 126.6 s and the
default Task 3 selection passed **78 of 78**.

The first Linux attempt, before the bounded wait gained its `flush()` fallback,
passed 2 of 3: the recovery test's first step exceeded the then 30 s delivery
bound, after which `flush()` completed delivery. A traced standalone run and a
second container run passed. This was not root-caused; it is consistent with
first-access latency on the bind mount. The fallback re-checks delivery and
fails if it is still absent.

## Not qualified

- Native coding-workflow acceptance: kernel, publisher-signed nine-tool
  manifest, signer pin, custody/launch profile, caller binding and signed
  recovery fixture remain open.
- Resource commit before retained native completion evidence is preserved as an
  unknown original. This change provides no reconciliation for it.
- P4 cross-authority adoption, P5, whole-Pi Linux confinement, actual x64
  runtime and live provider or kernel service behavior.

## Observations

Every native original lookup re-reads the operator context, which recompiles the
pinned registry's schemas. With the nine coding tools this measured roughly
90 ms per read and dominated workflow time. Durable `flush()` also re-observes every
retained intent, so frequent flushing is quadratic over a long session. Neither
affects correctness; both are recorded for later work rather than changed here.
