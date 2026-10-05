# Task 5: native governance and Pi session mediation

Date: 2026-10-04. Branch: `feat/pi-full-roadmap-20261004`. Implementation starts
from reviewed Tasks 1-4 at `b49b269`; root-owned native signature precision was
subsequently committed as `b420a49`. The dirty primary checkout was not edited.
Only Task 5 adapter, integration, focused test and documentation files are owned
by this change. Task 6 limits/Linux and Task 7 release work remain separate.

## Implemented scope

- Operator-created `NativeEmbedding`, independently pinned native installation
  binding and current-installation checks, captured callable ports, opaque
  WeakMap custody and installed sink/template selection. JSON native selectors
  refuse. Callback branding is not native authority or qualification.
- Final immutable normalized model JSON, SHA256/UTF-8 size/original identity,
  fixed provider route/profile/model/purpose, native process/context/history
  references and credential/limits identities. Native `releaseFrozenRequest`
  owns knowledge join, retained intent, commit ACK and provider submission.
  Required relay paths never perform an independent provider fetch.
- Native failures and lost commit ACK withhold provider bytes. Missing responses,
  post-submit failures and stream loss retain the original fence. Concurrent
  account lookup and later caller mutation cannot bypass required governance.
  Native durable fencing/accounting remain required across process restart.
- Exact governed relay ownership pinned into required Pi session creation and
  public runtime replacements, with read-only local relay credentials. Direct
  provider setup, lookalike URLs, forged handles and wrong bindings refuse.
- P2 public-view verification using real Ed25519, exact prefix/NUL/RFC8785
  framing, selected signer/domain/issuer/audience, closed fields/enums, safe
  30-second validity, sorted unique bounded candidates. Explanation output is
  advisory and cannot authorize an effect or bind a workflow/private graph.
- Native knowledge reservation/adoption/checkpoint CAS/restore/copy/archive
  seams, scoped opaque custody, foreign/raw reference refusal and complete
  retained history-reference join. Native classification, DAG and monotone
  knowledge checks remain mandatory; no local classifier or byte fallback.
- Native original recovery commands and accepted semantic-step custody: pending
  exact resume, denied linked continuation, unknown original reconciliation.
  No invented grant or local protected effect is introduced.
- Native child submit/reconcile/cancel/optional-wait with installed templates,
  closed launch-selection rules, original-request fencing and state-contract
  validation. The adapter never spawns after a precheck. The native host must
  retain and verify issuer/signature/capability/parent/request/budget before its
  confined launch and independently check registry/accounting.
- Actual Pi 1.0.2 initial preflight before SessionManager open/restore and agent
  creation, repeated public runtime-factory checks, original import-source
  validation, explicit lifecycle cancellation and native custom summary gates.
  Public boundary dispatcher refuses unmediated drafts. Mediated compact/tree
  operations use public session APIs. Executable discovery stays disabled.
- Default CLI refusal before credential/profile/service/provider access when
  required native governance is unavailable. Doctor gives explicit native-model,
  native-knowledge and Pi-custody unavailability; complete programmatic ports
  report native-qualification-required.

## RED evidence

Observed the initial focused run with 9 failures and 0 passes. The required
native-release-absent specimen sent provider bytes and returned HTTP 200 instead
of 502; the native composition, P2 and child APIs were absent. No production
implementation was added before observing this initial boundary failure.

Observed the initial lifecycle run with all 5 new feature tests failing: initial
preflight was absent, thrown native custody did not produce cancellation, the
public governed runtime and custom summaries were absent, and boundary drafts
were accepted. Corrected a fixture's invalid `branch(null)` call to exercise a
real earlier leaf in the installed public SessionManager API.

Further focused RED/GREEN cycles reproduced and fixed class-instance native
method loss, premature fence clearing after response-stream loss, missing adopted
history references, concurrent asynchronous account lookup producing two native
submissions, unchecked child launch selectors and verified-flag observations,
missing accepted semantic-step acquisition, default CLI credential access before
refusal, missing JSON selector/doctor gates, required SDK direct-provider setup,
post-installation caller mutation disabling required governance, unverified P2
DTO rendering, stale fixture-time reuse in the native explanation path, and the installed
public `setModel` restoring a remote provider route. The SDK stream seam now
repins same-model routes and refuses changed provider/model/API before egress. Each of
these fixes was verified with its focused failing specimen and then the complete
focused suite.

## Verification

| Command | Result |
| --- | --- |
| `npm run build` | Pass |
| `npm run typecheck` | Pass |
| `node --test test/governance.test.mjs test/delegation.test.mjs test/governance-lifecycle.test.mjs` | Pass: 39 tests, 0 failures, 0 skips |
| `npm test` | Pass: 322 tests, 0 failures, 0 skips |
| `git diff --check` | Pass |
| `shasum -a 256 vendor/chio-bridge-0.3.0-7d9e34f7408a.tgz` | Unchanged `7d9e34f7408a316e35125982a23faaecfd2f31f4da6b50ca8eab287c2c918f67` |

The installed public Pi dispatcher demonstrates that thrown lifecycle handlers
are swallowed; trusted handlers explicitly return cancellation. Public runtime
fork demonstrates that declared `skipConversationRestore` is ignored. Public
tree navigation preserves the original leaf after failed custody. The installed
provider dispatcher sends only to the exact governed relay and native release.
Public same-model `setModel` and stock bug-report summarization retain the relay
route; changed catalog models refuse before ordinary or summary provider bytes.
Original import-source validation runs before file copy, and projected transcript
changes leave native knowledge basis and retained history references intact.

The child-facade contract fixture uses real Ed25519 signatures with independent
retained-registry/accounting and launch observers. Missing authority, widening,
wrong issuer/budget family/signature, missing registry/accounting and substituted
template produce zero native fixture launches. Successful fixture ordering is
retained record, accounting check, confined-launch observer. Reconcile and cancel
cannot resubmit an already submitted original request. This is adapter/fixture
contract evidence, not native process-host or durability qualification.

## Self-review and limits

Confidence is high in the verified adapter behavior. No native host facade,
writer/broker, provider-effect service, semantic deployment, child admission
store, running kernel or P5/Linux acceptance was installed or qualified. The
stock-host/callback tests remain separate from those external requirements.
In-process model/child interlocks supplement native custody; they do not replace
native retained intent, accounting, restart reconciliation or durable fences.

Native services must atomically perform the cryptographic, classifier,
installation, source/recipient/account, monotone-knowledge, provenance-DAG,
issuer/budget and confinement checks specified by the ports. A trusted callback
that only echoes binding data or returns a state does not establish those
services. API account identity stays unknown absent independent native mapping.
The frozen bridge's child attenuation remains unsupported.

The SDK boundary seam cannot intercept arbitrary direct SessionManager mutation
or deliberate replacement of SDK stream functions by trusted host code. Native knowledge must remain monotone outside Pi projection
and rejoin at release. No context hook or cancellable session_start is claimed.
Provider-specific run caps still belong to Task 6, before final request freezing.
The reviewed Task 4 mappings, no-execute recovery and full-history-before-ACK
paths are unchanged. Frozen bridge/operator artifact identities were not edited.
