# Typed tools on Pi 1.0.2

The adapter pins the current native host to Pi coding-agent and pi-ai 1.0.2.
`createToolRegistry(operatorTools)` selects typed mode. Prepared operator JSON
uses optional `"toolMode": "typed"`, which is also the default. The installed
protected launcher passes one registry to its model relay and private guest
transport. Neither endpoint discovers additional tools.

The standard filesystem names map to `chio_read`, `chio_write`, `chio_edit`, and
`chio_list`. Other names get deterministic `chio_` aliases. Normalization
collisions, duplicate names and the reserved `chio_execute` alias are refused.
Arguments follow each operator-pinned native JSON schema directly. Pi's native
argument normalization cannot change the original model call before dispatch.

The registry owns deeply cloned, frozen JSON schemas and a canonical SHA-256
identity covering inventory, descriptions, mappings, exposure and mode. The
private gateway inventory must match the complete pinned tool specifications.
The relay checks exact declarations, choices, call arguments, call IDs and
terminal outcome argument bindings before delivery observation or network
egress. No MCP, codemode, deferred, resource-discovery, local file/shell, project
extension, skill or normal user-profile surface is activated.

Typed schemas are carried by native Pi declarations. The typed system prompt
carries only registry identity and alias guidance. It does not repeat schemas.
Tests verify this context representation; they do not measure task-success gains.

Set `"toolMode": "legacy"` in prepared operator JSON, or explicitly select
`createToolRegistry(operatorTools, "legacy")`, for generic-wrapper comparisons.
That mode exposes `chio_execute` with `tool` and `arguments`, validates the
underlying pinned schema, and includes the kernel inventory in its prompt.
Production prepared configurations still require an explicit nonempty inventory.
Changing mode, schemas, descriptions or mappings cannot resume a bound profile.

Protected gateway mode returns the entire verified gateway outcome in native Pi
history, including original request ID, signed receipt and delivery material.
The trusted parent observes that history before kernel ACK. Denied history must
match the exact original private operation, reason and receipt, and pass public
receipt verification against the retained caller, resource, request and arguments.
Denials never ACK or clear their retained fence. Approval adds only
the bridge's exact `chio_resume` contract and retains the original tool and
arguments. The parent-only journal stores `pi-host.binding`, binding Pi
version, registry digest and retained authority independently of guest-writable
profile metadata. Incompatible frozen profiles are refused without migration.

The unprotected programmatic comparison seam retains its previous uncertainty
interlock: it can ACK after durable local result retention, before native
conversation insertion. It is not the protected native-history delivery profile.
Explicit Pi Durable delivery/recovery integration is a later roadmap task.

Run `npm run typecheck && npm test` for component and stock-host contracts.
These checks exercise actual Pi dispatch and callable inventories with scripted
providers. Signed gateway fixtures cover transport binding; they do not qualify
a real kernel, model provider, host confinement backend or semantic profile.
The frozen Pi 0.85.1 artifacts and qualification evidence remain historical.
