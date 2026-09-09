# Chio for Pi

This candidate runs the real Pi SDK with a native Chio extension. Pi can perform useful file work through the Chio kernel. Local file, shell, network, extension, and delegation tool paths are unavailable in its protected mode. All protected operations are executed by the kernel's configured resource server.

**Acceptance is incomplete.** [Acceptance](docs/ACCEPTANCE.md) records the real host observations and every remaining gate. This is a qualified development candidate, not an announced accepted release.

The Pi SDK process and operator profile are trusted in this candidate. There is no OS sandbox around that process: it can read its prepared credential and contact the kernel. The tested restriction applies to model-reachable tools, with the protected filesystem owned by a separate resource container. Arbitrary host process compromise and a hostile same-UID program are not covered by the current evidence.

## Version combination

- Pi: `@earendil-works/pi-coding-agent@0.85.1`, upstream `d981de1229ef899957bbe968bc8dcda02a21f477`.
- Plugin: `@chio/pi-plugin@0.1.0` candidate.
- Bridge: `@chio/bridge@0.3.0` candidate, embedded in the release tarball. Its exact SDK is bundled too.
- Node: 22.19.0 or later; tested with 25.5.0 on macOS arm64.
- Kernel: the execution-evidence/context candidate identified in the acceptance record. The public CLI 0.1.0 cannot substitute for it.

## Install the candidate artifact

Obtain the matching release tarball, SHA256 and provenance files, kernel artifact, and private operator-prepared configuration from the candidate distribution. Verify the artifact hash before installation. The provenance identifies the source commit, source cleanliness, dependency lock and bridge artifact hashes, and host version. The release tarball contains the unpublished Chio bridge and SDK; npm installs the exact public Pi and TypeBox versions. It needs registry access and no private sibling checkout.

```sh
shasum -a 256 -c chio-pi-plugin-0.1.0.tgz.sha256
mkdir pi-install
cd pi-install
npm install --ignore-scripts --install-strategy=nested @earendil-works/pi-coding-agent@0.85.1
npm install --ignore-scripts --install-strategy=nested /absolute/chio-pi-plugin-0.1.0.tgz
./node_modules/.bin/chio-pi --help
```

Use a dedicated operator profile and a disposable local working directory. The kernel tool server must not mount the profile, plugin installation, model credentials, or kernel administrative state. The tested filesystem resource server exposes only its designated Docker volume. Its process has no agent-accessible shell or direct route to the host filesystem.

## Configure and run

The operator prepares a retained kernel session with `chio-prepare-gateway`, shipped in the bridge artifact. It obtains the actual caller/capability context and tool schemas from the kernel. Its input and output are private mode-0600 files. Supply explicit bearer authority, trusted signer, server ID, allowed tools, and logical session ID; never ask the model to supply them. See the shared kernel/bridge runbook for provisioning authority and the resource server.

The resulting configuration must include `execution.endpoint`, `execution.bearerToken`, `execution.trustedSigners`, `execution.subjectKey`, `execution.capabilityId`, `execution.serverId`, `execution.sessionId`, a logical `sessionId`, and the explicit `tools` inventory. The plugin refuses missing retained sessions or executable transport configuration.

Provide the model provider's supported API key through the environment. The runner uses a separate Pi credential/cache location and does not read the normal Pi configuration.

```sh
./node_modules/.bin/chio-pi \
  --config /absolute/private/pi-gateway.json \
  --profile /absolute/private/pi-profile \
  --cwd /absolute/disposable/pi-workspace \
  --provider openai --model gpt-4.1-mini \
  --prompt 'Write /workspace/note.txt through the kernel, then read it back.'
```

The output is JSONL containing actual Pi messages, tool results, and the retained session path. Kernel receipts are included with verified successful results. Keep this output private when task inputs or results are sensitive. The model calls `chio_execute` with the operator-listed tool name and arguments.

The terminal `chio_session` record includes an explicit outcome. Unresolved resource outcomes exit 2, provider/runtime failures or incomplete generation exit 1, and cancellation exits 130 (SIGINT) or 143 (SIGTERM). Token truncation is `incomplete`, never completed. A task that completes after intermediate recoverable tool errors is labeled `completed_with_tool_errors`; inspect its actual tool results. A normal model explanation cannot erase a retained uncertainty interlock.

The runner deliberately exposes print/SDK execution only. It does not pass arbitrary flags, file attachments, raw RPC requests, interactive shell commands, or third-party extension loading to Pi. The [action inventory](docs/ACTION-INVENTORY.md) defines the complete supported surface.

## Resume, recover, upgrade, remove

To resume, use the same config/profile/cwd/model options and add `--resume` with the retained `sessionFile` printed by the previous run. The path must be inside that profile's sessions directory. A changed authority, signer, retained kernel session, or tool allowlist refuses reuse of the existing profile.

The plugin durably records an operation before dispatch. A lost response, invalid evidence, interruption, or denial leaves an interlock at `PROFILE/chio/unresolved-kernel-operation.json`. Subsequent protected calls refuse dispatch. A signed denial can originate after an effect, so it is also held for review. Completed results are retained under their original Pi session/tool-call identity and can be replayed without repeating an effect.

Do not clear an uncertain record or switch to a fresh profile merely to retry. The operator must reconcile the original request with the kernel receipt/admission record and independently observe the resource. Archive the evidence and resolve through the kernel's supported recovery procedure before authorizing new work. If no authoritative outcome is available, retain the unknown state. A crash may leave `PROFILE/chio/pi.lock`; verify its recorded process has exited and resolve outstanding operations before removing that stale process lock. Removing a lock alone does not clear the operation interlock.

For an upgrade, stop the runner and let in-flight calls settle. Archive the private config, session files, operation records, artifact hashes, and receipts. Install the next pinned artifact into a new directory, verify it, and reuse the retained profile only with compatible authority/configuration. Repeat the useful-work and failure checks in a disposable resource environment before moving the workload. Do not overwrite or discard unresolved operations during upgrade or rollback.

For removal, stop the runner, preserve required evidence, close/revoke its retained kernel session and capability through the operator's kernel administration procedure, and delete only the dedicated installation/profile after outstanding outcomes are resolved. No normal Pi configuration was modified and no global uninstall is required.

## Source development and release packing

```sh
npm ci --ignore-scripts
npm test
npm run pack:release
```

The source manifest intentionally does not declare bundled dependencies. npm 11 can flatten an already bundled SDK and attempt to download an unpublished candidate when such a declaration is present during source installation. The release script copies the selected files to a temporary staging directory, bundles the installed Chio dependency there, emits the tarball and SHA256, and leaves source metadata unchanged. It refuses dependency paths outside this checkout's own `node_modules`.

The exact Pi host is a peer dependency. Install it directly using the first command above: a tested npm 11 transitive-install path omitted dependencies from Pi's published shrinkwrap despite exiting successfully. Always run `chio-pi --help` and the disposable kernel workflow after installation; npm's exit status alone is insufficient validation.

`npm test` contains deterministic stock-Pi dispatcher tests and client recovery tests. They are not real kernel acceptance. The retained live JSONL observations and independent resource observations are recorded separately under `evidence/` in the source repository.
