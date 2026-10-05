# Getting started

The complete operator walkthrough for Chio for Pi: building and verifying the
candidate archive, running a protected task, the execution boundary, and
resuming or recovering a session. The [README](../README.md) is the short tour.

## Status and qualification

This is an unpublished restricted candidate. The public Pi
peer is available on npm; build this plugin from source below. Bounded real-host
observations exist, while complete published-release acceptance remains open.
[Current qualification](FINAL-QUALIFICATION.md) covers only the frozen
`@chio/pi-plugin@0.1.0` archive `ec609539...` with Pi 0.85.1 on macOS, together
with its [static-kernel follow-up](STATIC-KERNEL-QUALIFICATION.md). The
`0.2.0` candidate built from this source targets Pi 1.0.2 and has component,
stock-host, local confinement and cold-consumer evidence only. The
[roadmap crosswalk](ROADMAP-IMPLEMENTATION.md) lists, for each feature, its
entrypoints, evidence and open native prerequisites. A rebuilt archive has its
own identity.

## Build and install

Use Node.js **22.19.0 or newer** and npm. Native runtime observations used Node
25.5.0 on macOS 26.4 arm64; the release build uses Node 22.19.0 with npm 11.8.0.
The protected launcher requires macOS `sandbox-exec`, or Linux bubblewrap with a
pinned runtime manifest as described in [run limits and Linux](RUN-LIMITS-LINUX.md).

Start in a new working directory:

```sh
git clone https://github.com/backbay-labs/chio-pi-plugin.git
cd chio-pi-plugin
npm ci --ignore-scripts
npm run pack:release
```

The packer builds TypeScript and writes a tarball, SHA-256 file and provenance
record to `artifacts/`. Checked-in vendor archives supply the Chio bridge and SDK;
the resulting package bundles them. No private sibling checkout is required.

Install the exact public Pi peer first, then the local plugin archive:

```sh
(cd artifacts && shasum -a 256 -c chio-pi-plugin-0.2.0.tgz.sha256)
mkdir ../chio-pi-install
cd ../chio-pi-install
npm install --ignore-scripts --install-strategy=nested --save-exact \
  @earendil-works/pi-coding-agent@1.0.2
npm install --ignore-scripts --install-strategy=nested \
  ../chio-pi-plugin/artifacts/chio-pi-plugin-0.2.0.tgz
./node_modules/.bin/chio-pi --help
./node_modules/.bin/chio-coding-resource --help
```

To use the optional [Pi Durable adapter](CONTINUATION.md#native-pi-durable-tools),
add `@earendil-works/pi-durable@1.0.2` to the first command so both exact peers
are installed before the plugin. The root entrypoint never loads Pi Durable.

Registry access is required for Pi and the public TypeBox and Ajv dependencies.
Keep the peer-first, nested installation order: it avoids the documented
transitive resolution failure in Pi's published shrinkwrap. Exact peers do not
freeze Pi's transitive graph, so keep the consumer lockfile. Help verifies the
entrypoints; it does not start protected execution. See
[release qualification](RELEASE-QUALIFICATION.md) for clean installation
checks, provenance and publication procedures.

## Run a task

First [provision a compatible Chio kernel and isolated resource server](https://github.com/backbay-labs/chio/blob/70071260afe514b06cac1c319487bd48e465d39e/integrations/required-agents/README.md),
then prepare a retained session with the bridge's `chio-prepare-gateway` command.
The original public CLI 0.1.0 does not supply the required contract. Use the
kernel and operator-tool identities in the [compatibility record](FINAL-QUALIFICATION.md#supported-combination)
and its [static-kernel follow-up](STATIC-KERNEL-QUALIFICATION.md). Those
identities were qualified with the frozen 0.1.0 archive; no kernel is yet
qualified with the 0.2.0 candidate.

The prepared configuration binds the actual caller, capability, kernel session,
server, trusted signer and explicit tool inventory. It must contain the delegated
`chio.mcp.session-credential.v1` metadata and a private gateway journal path.
An operator-wide bearer is refused. The current launcher requires a kernel
endpoint at `http://127.0.0.1:PORT`.

Keep the private configuration, authoritative journal, installation, empty Pi
profile and disposable local working directory separate. The kernel resource
server must not mount credentials, the Pi profile or installed code. In the
example, `/workspace` belongs to that resource server, not the local `--cwd`.

With `OPENAI_API_KEY` already set in the operator's environment:

```sh
./node_modules/.bin/chio-pi \
  --config /absolute/private/pi-gateway.json \
  --profile /absolute/private/pi-profile \
  --cwd /absolute/disposable/pi-workspace \
  --provider openai --model gpt-4.1-mini \
  --prompt 'Write /workspace/note.txt with the text "Hello from Pi", then read it back.'
```

Pi calls typed native tools generated from the pinned inventory, such as
`chio_write` and `chio_read`; prepared `"toolMode": "legacy"` selects the
generic `chio_execute` wrapper instead. See [typed tools](TYPED-TOOLS.md).
JSONL output contains Pi messages, tool results and a retained `sessionFile`;
verified successful results include kernel receipts. Keep that output private
when task content is sensitive.

For ChatGPT subscription mode, replace the provider/model line with
`--provider openai-codex --model gpt-5.5` and add
`--codex-auth /absolute/private/codex/profile/auth.json`. The operator supplies a
private native Codex login cache outside all guest paths. Native Codex owns login
and refresh; this launcher reads the cache without copying or refreshing it.
The account must have access to the selected model. Current native qualification
uses this subscription mode; API-key evidence belongs to earlier artifacts.
[Provider and operational details](FINAL-QUALIFICATION.md#operation-and-limitations)
record that distinction.

## The execution boundary

```mermaid
flowchart LR
    Pi["Pi SDK + typed Chio tools\nUntrusted macOS or Linux sandbox"]
    Parent["Trusted launcher\nGateway, journal and model relay"]
    Kernel["Chio kernel\nAuthority, guards and signed receipts"]
    Resource["Isolated resource server\nProtected files"]
    Model["Selected model provider"]
    Pi -->|Local transport| Parent
    Parent -->|Retained session| Kernel
    Kernel -->|Execute| Resource
    Parent -->|Provider credentials| Model
```

The installed `chio-pi` launcher establishes the process boundary. Pi can write
its dedicated profile and contact only the launcher's local gateway and model
relay. Kernel credentials, provider credentials and the authoritative journal
stay in the trusted parent. Receipt and result verification precede delivery
acknowledgement; the parent confirms delivery through Pi's native tool history
before another model turn.

The supported mode exposes print/SDK execution and kernel-owned file workflows.
A kernel can also own the separate [coding resource](CODING-RESOURCE.md) for
search, patches, confined tests and exact artifact publication. Arbitrary native
codemode and deferred execution stay disabled; the resource's bounded `read_many`
is the implemented aggregate alternative.
Native file and shell tools, third-party extension discovery, delegation,
background jobs, attachments, raw RPC and interactive commands are unavailable.
Tool calls are sequential. Loading the extension into an ordinary Pi session or
embedding the exported SDK helpers requires a separate process boundary. The
protected launcher refuses source-checkout execution and has no sandbox bypass
flag. The [action inventory](ACTION-INVENTORY.md) describes each surface and
its resource owner.

## Resume and recover

Resume with the same configuration, profile, workspace and model options, adding
`--resume /absolute/private/pi-profile/sessions/SESSION.jsonl` for the retained
`sessionFile`. The path must be inside that profile's sessions directory. Changed
authority, signer, session or tool inventory refuses profile reuse.

The terminal `chio_session` record carries the outcome. Unresolved operations
exit 2, tool errors retained at task completion exit 3, and pending approval exits
4. Provider/runtime failures or incomplete generation exit 1; cancellation exits
130 or 143. A model's explanation does not clear uncertainty.

Use the [trusted operator console](OPERATOR.md) for `chio-pi doctor`, `status`,
`inspect` and explicit native `recover` actions without launching a model.

Inspect retained outcomes with `chio-gateway-operator status CONFIG` in a trusted
operator installation. Preserve the original request, configuration and journal;
never clear them or mint new authority to retry an uncertain effect. Dead-owner
lock recovery only releases a stale process lock. Exact-result reconciliation
uses the separately pinned operator utility described in the
[recovery procedure](FINAL-QUALIFICATION.md#operation-and-limitations).
A configured approval flow resumes the original request and arguments after an
operator decision. Session expiry must not silently create replacement authority.

For upgrades, stop the runner, retain unresolved state and install the next
verified artifact into a new directory before checking compatibility. For
removal, resolve outstanding outcomes, close or revoke the retained authority,
and remove only the dedicated installation and profile. Keep required receipts
and private operator state. [Release operation](RELEASE-QUALIFICATION.md#verify-and-recover)
and the [qualification record](FINAL-QUALIFICATION.md) cover the
supported procedures and their limits.

## Development

From the source checkout, after `npm ci --ignore-scripts`:

```sh
npm run typecheck
npm test
npm run pack:release -- /absolute/new-candidate-directory
node scripts/qualify-release.mjs --release /absolute/new-candidate-directory \
  --work /absolute/new-scratch-directory --evidence /absolute/new-evidence-directory
```

The last command installs the candidate into fresh base and Durable consumers;
see [release qualification](RELEASE-QUALIFICATION.md#candidate-020).

The root entrypoint exports `chioExtension`, `createChioPiSession`,
`createToolRegistry`, `bridgeExecutor`, `readPreparedConfig`, `configuredExecutor`
and the continuation, governance and limits APIs for adapter development. Their
[TypeScript entrypoint](../src/index.ts) exposes the corresponding types.
`@chio/pi-plugin/coding-resource` exports the resource participant and
`@chio/pi-plugin/durable` the optional Pi Durable adapter. These in-process APIs
do not establish the launcher's OS boundary on their own. The
[roadmap crosswalk](ROADMAP-IMPLEMENTATION.md#shipped-entrypoints) lists a
runnable check for every shipped entrypoint.

Breaking change in 0.2.0: `chioExtension(executor)` without a registry now throws.
In 0.1.0 it registered the single `chio_execute` tool; pass
`createToolRegistry(tools, "legacy")` for that surface or a typed registry.

Deterministic stock-Pi dispatcher and recovery tests run through `npm test`.
Real host/kernel observations, independent resource checks and preserved failures
live in the [evidence records](FINAL-QUALIFICATION.md). Source checks and
packaging success remain separate from runtime acceptance.

