# Trusted Pi operator console

`chio-pi doctor`, `status`, `inspect` and `recover` run in the trusted operator
process before protected-launch platform, provider-authentication and installed
plugin checks. They require the installed bundled bridge, a private prepared
configuration and its original native journal. They do not start Pi, a model
session or a model relay, read a provider login cache, or change a Pi profile.

Diagnostics contact no service. Explicit recovery actions delegate to the native
bridge utility using Node argv, without a shell. Delivery ACK and approval submission
contact the configured native endpoint. They do not dispatch a protected tool.

## Inspect before recovery

```sh
chio-pi doctor --config /absolute/private/prepared.json
chio-pi status --config /absolute/private/prepared.json --json
chio-pi inspect --config /absolute/private/prepared.json \
  --request ORIGINAL_REQUEST_ID --json
```

`doctor` shows the installed operator code hash, current configured tool registry,
caller, capability, resource owner and available utility contracts. Token and
budget counters are `null`: this artifact does not expose authoritative values.
Configured `issuedAt` and `expiresAt` are labeled configuration metadata with
`liveValidation: unavailable`. They do not prove current validity, revocation
state or authority to replace an expired session. Resource path scope is `null`
when the prepared public metadata does not expose it.

`status` reports native journal state and its conservative fence. It does not
verify effect signatures. `inspect` reads the original private operation and
checks its request identity, pinned arguments and native request digest. A
completion is labeled verified only after public `verifyCompletedOutcome`
validates its trusted signature, signed result, caller, resource, original
request, arguments and delivery proof. A denial requires public
`verifyBoundReceipt`, the signed denial verdict and its exact original reason.

| Reported state | Meaning and next step |
| --- | --- |
| `completed_pending_acknowledgement` | Native retained completion; inspect signed evidence, then recover original delivery explicitly. |
| `completed_acknowledged` | Native ACK and required host delivery are recorded; inspect before trusting the effect. |
| `unknown_after_dispatch` | Native pending or unknown operation; preserve its original identity and reconcile with the resource owner. |
| `approval_pending` | Exact undispatched native proposal; inspect/submit it. Decision retention requires a separately qualified native operator. |
| `not_dispatched` | Native retained non-dispatch for this operation; it does not resolve another operation. |
| `denied` | A signed denial can follow an earlier effect. Its fence remains in place. |

An absent record never proves no dispatch or permits a fresh retry. Inspection
does not change the journal, ACK delivery or clear a fence. The native gateway
stores an undispatched approval as a proposal without a separate request field;
inspection reconstructs that exact original request from the proposal and checks
its bound authority, arguments and digest, without calling it signed effect proof.

## Recover the original delivery

Choose a new private output outside the authoritative journal. Native export
creates a mode-0600 artifact containing the complete original request, result,
receipt and private delivery proof. Console output redacts credentials and ACK
secrets. Preserve the private artifact when transferring it to its receiving host.

```sh
chio-pi recover --config /absolute/private/prepared.json \
  --action delivery-export --request ORIGINAL_REQUEST_ID \
  --output /absolute/private/received-original.json --json

chio-pi recover --config /absolute/private/prepared.json \
  --action delivery-acknowledge \
  --input /absolute/private/received-original.json --json
```

Listing and export never ACK. ACK requires the received artifact to equal the
original retained request and verified completion, exclusive native gateway
ownership, and confirmation from the retained kernel session. It sends only the
original delivery proof, without replaying the protected effect. If ACK fails,
retain the artifact and journal; inspect again rather than rerunning the effect.

## Submit the retained approval

The operator file is private JSON containing a distinct `adminToken`. Supply its
path, never the credential itself, as an argument. Normal native preparation uses
a bare-origin execution endpoint; `sessionCredential.endpointPath` is `/mcp`.
Credential-bearing URLs and hand-authored MCP-path endpoints are refused.

```sh
chio-pi recover --config /absolute/private/prepared.json \
  --action approval-submit --request ORIGINAL_REQUEST_ID \
  --operator /absolute/private/operator.json \
  --output /absolute/private/submitted-approval.json --json
```

Submission reserves its new private output outside the authoritative journal
before the admin request. It neither decides the approval nor installs a native
resume credential. The original operation remains an undispatched proposal.
A failed or timed-out submission does not prove the admin record was unchanged;
reconcile that original proposal before repeating submission.

`approval-decide` is unavailable for both `approved` and `denied`. The adapter
refuses it before reading configuration, launching a native child, contacting an
admin endpoint or creating an artifact. The frozen utility verifies a signed
exact-request credential but does not bind its decision and approval ID to the
operator's requested values before retaining it. A valid approved credential
returned for a requested denial can then be consumed automatically by native
`chio_resume`. Checking it after retention cannot prevent that activation.

Decision retention requires a separately qualified native operator that checks
the requested decision **and** approval ID against the signed credential before
the artifact is retained. The gateway's exact original signed-resume contract is
preserved: an independently qualified original credential may authorize only its
retained request, tool and arguments. Utility existence or version 0.3.0 does not
qualify this missing decision-binding contract. See
[native prerequisites](NATIVE-PREREQUISITES.md).

## Recover a dead gateway owner lock

```sh
chio-pi recover --config /absolute/private/prepared.json \
  --action recover-lock --json
```

The native utility removes only a gateway lock whose owner belongs to this
retained session, is on this host and can be proved dead. Alive, foreign-host,
unverifiable and changed locks are refused. Every operation journal and original
fence remains in place. This action does not reconcile an unknown effect.

## Recover a stale parent run-limits owner lock

The protected launcher's model accounting lives in
`<native-journal>/pi-run-limits/<sha256-of-absolute-profile>/`. `run.json` is the
accounting record. `owner.json` exists while a launcher owns it and names the
owner's host identity, PID and, once the guest is spawned, `guestProcessGroup`.
A launch recovers a lock automatically only when the owner is on this host, its PID
is gone and its recorded guest process group is gone. Otherwise it refuses with
"Run budget has an active owner lock", "Run owner belongs to another host or PID
namespace", "Run owner's guest process group ... still exists or is unverifiable"
or "Run owner recovery lock unavailable". After a reboot, a hostname change (macOS
can change it dynamically) or a container restart that reuses PIDs, the recorded
identity proves nothing and the lock stays until an operator acts:

1. On every host that can reach this journal, confirm that no `chio-pi` launcher
   and no `sandbox-exec` or `bwrap` guest for this profile is running, for example
   `ps -A -o pid,pgid,stat,command | grep -F -- /absolute/profile`. If `owner.json`
   names a `guestProcessGroup`, confirm no executing member remains:
   `ps -A -o pid,pgid,stat,command | awk -v g=GROUP '$2 == g'`. Stop a surviving
   guest of this profile first. After a reboot the number can belong to an
   unrelated process; never signal a group you have not identified.
2. Move `owner.json` out of the accounting directory into a private operator
   location for inspection. If an empty `owner-recovery` directory remains from an
   interrupted recovery, remove it with `rmdir`.
3. Never edit, delete or recreate `run.json`. Its counts and absolute deadline
   must survive.
4. Launch again. The launcher takes a new lock and resumes the existing record.

This procedure never reconciles a native operation; use `chio-pi recover` for that.

## Boundaries and unavailable contracts

Private configuration, journal, input and output paths must be owned by the
current user. Files are private regular files with no leaf symlinks and a 1 MiB
limit. File type, ownership, permissions and size are checked before opening;
nonblocking, no-follow opens and descriptor revalidation reject FIFO and other
nonregular inputs without waiting for a writer. Journal authority and any retained
`pi-host.binding` must match the prepared configuration. Unexpected or duplicate arguments fail before a native
subprocess or mutation. Existing outputs and any output inside the authoritative
journal are refused. Native child stdout/stderr and raw parse errors are not
forwarded. Sensitive auth fields and known secret values are redacted from both
JSON and readable console output. Credential objects, including signed approval
tokens, are hidden as a whole. Their public request, caller, signer, resource,
tool, path and schema bindings remain visible wherever the report needs them for
original recovery. Only actual secret fields and credential signature material
are collected for redaction when echoed in other fields; public receipt proofs
remain visible.

The installed native entrypoint is resolved through public
`@chio/bridge/package.json`, checked for realpath containment within the installed
package, and executed as `node ENTRYPOINT ACTION CONFIG ...`.

The bundled `chio-bridge-0.3.0-7d9e34f7408a.tgz` does not support owner-result
import or native capability attenuation. All inspected bridge variants report
0.3.0, so semver does not qualify a different utility. Unknown outcomes requiring
owner import use only the separately qualified native exporter/importer in
[FINAL-QUALIFICATION.md](FINAL-QUALIFICATION.md); this console does not substitute
a local importer or fabricate signatures. Semantic recovery, a coding resource,
cross-host Durable recovery and whole-host Linux execution are not implemented
by these commands. The extensible doctor table reports those capabilities as
unavailable. [NATIVE-PREREQUISITES.md](NATIVE-PREREQUISITES.md) records their native
contracts and qualification boundaries.

The programmatic API exports `OperationSummary`, `summarizeGatewayStatus(status)`
and `runOperatorCommand(args)`. The command runner writes a redacted report and
returns 0 for success or 1 for refusal. Component fixtures using the bundled
utility do not qualify a real kernel, model provider or confinement backend.
