# Native Codex subscription qualification

Historical candidate record for archive `78257af6...`, superseded by
[FINAL-QUALIFICATION.md](FINAL-QUALIFICATION.md) for archive `ec609539...`.
The original artifact identities and failed attempts below remain unchanged.

The supported provider is the pinned Pi 0.85.1 native `openai-codex` provider,
using `openai-codex-responses` and exact model `gpt-5.5`. Pi documents ChatGPT
Plus/Pro subscription support in its [provider documentation](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/providers.md).
The implementation was checked against the installed 0.85.1 provider source and
actual requests. No generic OpenAI API-key adapter substitutes for that contract.

## Exact candidate

| Component | Identity |
| --- | --- |
| Integration source | `70557f47efa38772e5cd600b5ce689a8c78706e3` |
| Plugin archive SHA256 | `78257af62fc840d8806dd9d90f124ff8c0a2a9b63f3588a4adb6bee4a44a6960` |
| Bridge archive SHA256 | `7d9e34f7408a316e35125982a23faaecfd2f31f4da6b50ca8eab287c2c918f67` |
| Host | `@earendil-works/pi-coding-agent@0.85.1` |
| Native provider / model | `openai-codex` / `gpt-5.5` |
| Kernel binary SHA256 | `33dd1dea21a4ca5ecddeab4f30f6b06b0b90c513f0987aef552b0633d9da1e25` |
| Resource image | `sha256:188cb84d5d0bb4063d4ce5a3b9c3832445a5acda5604911cda80a9136d1850a0` |
| Resource / independent audit volumes | `chio-required-pi-http-20260909` / `chio-required-pi-http-20260909-audit` |
| Environment | macOS arm64, Node v25.5.0, dedicated profiles, loopback owner port 58493 |

The final source had no tracked changes at packing. Provenance truthfully reports
`sourceDirty: true` because retained untracked evidence and unrelated existing
files were preserved. These files are outside the package file selection. The
archive produced before and after the source commit was byte-identical.

## Cold installation and real effects

`evidence/2026-09-09/codex-subscription-cold/` records a fresh installation using
an initially empty npm cache and the documented direct pinned Pi peer install,
followed by the Chio archive. There are no source overlays or private sibling
imports. The installed bin help was executed, then the same installed package
ran the actual Pi host with a live ChatGPT subscription and real kernel.

- Useful work: write, edit, read, list. Exit 0, exactly four independent resource
  dispatches, final bytes `Pi kernel verified`, and four private gateway records
  with both native-history delivery confirmation and owner acknowledgement.
- Forbidden read and write: one actual native tool attempt each, exit 3, verified
  denial and zero independent resource dispatches. Resource files and audit log
  remain unchanged. The host does not claim task success from its final prose.
- The exact launched sandbox policy denied operator and native subscription
  cache reads, Data-volume aliases, symlink escapes, configuration/code writes,
  hardlinks, Node/shell descendants, direct kernel networking and an unrelated
  listener. Read/listener controls succeeded outside the sandbox. These are
  explicitly operator-injected OS probes, separate from model-selected tools.
- Exact credential scans found no provider access/refresh/ID token, account ID,
  or kernel bearer in the three guest profiles or retained cold-run evidence.
  The native Codex cache was read only by the parent. No OAuth refresh was run.

Twenty-one component tests passed without skips. They cover the native provider
auth shape, bounded compressed relay input, fixed endpoint/account/model,
forbidden provider routes and references, inline encrypted reasoning, native
assistant phase preservation, malformed-cache secret redaction and existing
host/client contracts. Component tests are not real-host acceptance.

## Preserved failed candidates

`codex-subscription-intermediate/` records the initial real run: an authorized
write completed, then the relay rejected the next native history because the
reasoning item included `content: []`. The signed completed result stayed
unacknowledged; there was no second dispatch. The operator explicitly exported
and acknowledged that original result without protected redispatch.

`codex-subscription-contract/` records a separate failed in-place npm reinstall.
npm failed with `Cannot read properties of null (reading 'resolve')`, leaving the
old same-version package installed. The driver was mistakenly started before
that install result was inspected, so it reproduced the earlier refusal after
one authorized write. Its original result was also explicitly recovered without
redispatch. Neither directory qualifies the repaired artifact. Installing into
a new directory, as documented for upgrades, succeeded.

`codex-subscription-native/` records the first successful fresh-directory run of
the repaired archive. `codex-subscription-cold/` repeats it with the final
source identity and fully empty-cache installation.

## Reproduction

Build and pack at the recorded source commit, verify the archive SHA256, and use
the README installation and native Codex login-cache instructions. The actual
host driver is `scripts/qualify-http-host.py` with `--provider openai-codex
--model gpt-5.5 --codex-auth /absolute/private/native-codex/auth.json`, an installed
package directory and a fresh designated operator/resource environment. It
records raw host events, redacted configuration, independent Docker resource and
audit snapshots, terminal results and private-journal acknowledgement states.

Never copy the login cache into the guest, enable a fallback provider/model, or
replace authority to recover an uncertain operation. Native Codex owns refresh.
Unsupported account/model, expired login or relay failure must fail explicitly.
