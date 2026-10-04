# Trusted Pi operator console

`chio-pi doctor`, `status`, `inspect` and `recover` run in the trusted operator
process before protected-launch platform, provider-authentication and installed
plugin checks. They require the installed bundled bridge, a private prepared
configuration and its original native journal. They do not start Pi, a model
session or a model relay, read a provider login cache, or change a Pi profile.

Diagnostics contact no service. Explicit recovery actions delegate to the native
bridge utility using Node argv, without a shell. Delivery ACK and approval actions
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
| `approval_pending` | Exact undispatched native proposal; inspect its original arguments before an operator decision. |
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

## Decide the retained approval

The operator file is private JSON containing a distinct `adminToken`. Supply its
path, never the credential itself, as an argument. Normal native preparation uses
a bare-origin execution endpoint; `sessionCredential.endpointPath` is `/mcp`.
Credential-bearing URLs and hand-authored MCP-path endpoints are refused.

```sh
chio-pi recover --config /absolute/private/prepared.json \
  --action approval-submit --request ORIGINAL_REQUEST_ID \
  --operator /absolute/private/operator.json \
  --output /absolute/private/submitted-approval.json --json

chio-pi recover --config /absolute/private/prepared.json \
  --action approval-decide --request ORIGINAL_REQUEST_ID \
  --operator /absolute/private/operator.json \
  --approval ORIGINAL_APPROVAL_ID --decision approved --json
```

Use `--decision denied` for an explicit refusal. Submission reserves its new
private output before the admin request. Decision writes the native signed
approval artifact into the journal's private `approvals/` subdirectory. The
original operation remains an undispatched proposal until an explicit native
`chio_resume` uses its exact original request, tool and arguments. A failed or
timed-out admin response does not prove the operator decision was unchanged;
reconcile that original approval before repeating an admin action.

## Recover a dead gateway owner lock

```sh
chio-pi recover --config /absolute/private/prepared.json \
  --action recover-lock --json
```

The native utility removes only a gateway lock whose owner belongs to this
retained session, is on this host and can be proved dead. Alive, foreign-host,
unverifiable and changed locks are refused. Every operation journal and original
fence remains in place. This action does not reconcile an unknown effect.

## Boundaries and unavailable contracts

Private configuration, journal, input and output paths must be owned by the
current user. Files are private regular files with no leaf symlinks and a 1 MiB
limit. Journal authority and any retained `pi-host.binding` must match the
prepared configuration. Unexpected or duplicate arguments fail before a native
subprocess or mutation. Existing outputs and any output inside the authoritative
journal are refused. Native child stdout/stderr and raw parse errors are not
forwarded. Sensitive auth fields and known secret values are redacted from both
JSON and readable console output.

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
