# Pi process boundary qualification

Status: partial, not complete kernel acceptance. Source changes are awaiting the shared delegated-credential artifact and full installed-host rerun.

The protected entrypoint is `chio-pi`, which starts the published Pi SDK in a separate macOS Seatbelt process. Its read allowlist contains the installed dependency tree, actual Node executable/dylibs, specific immutable OS library paths, its own delegated config and profile. Only the profile is writable. Paths are canonicalized before policy generation; profile, configuration and installation cannot overlap. An empty profile is marked for the retained session, and unmarked nonempty directories are refused.

The policy permits only the configured local kernel port and an ephemeral local model relay port. Seatbelt's remote endpoint syntax on the tested OS accepts only `localhost` or `*`, not arbitrary IP/host allowlists. The model relay therefore owns outbound provider traffic. It keeps the provider key outside the guest, authenticates a random guest relay credential, accepts only `POST /v1/responses`, pins `gpt-4.1-mini`, disables provider storage/background work and hosted tools, and validates complete inline text/function history. Provider item IDs are removed instead of resolving another stored item. The real Pi SDK continues to construct and consume the provider's Responses stream.

The guest's environment is constructed explicitly; it does not inherit operator secrets, Node injection options or proxy settings. `PI_CODING_AGENT_DIR` selects its dedicated profile. `OPENSSL_CONF=/dev/null` prevents a read of the host's OpenSSL config. Precise system lookup permissions support Pi's use of `os.homedir()` without granting normal-home file data. All syscall-read permission is not granted: selected hardware and OS names are allowed, while parent-process argument/environment sysctls remain outside the allowlist.

## Executed observations

`evidence/2026-09-09/sandbox-process/model-only-v6.jsonl` records an actual OpenAI-backed Pi model completion under the policy whose SHA256 is `559ec2783d9b57808fd2904ecc33fe7cdc76c58533e63993b135b7d85fa2f5a0`. This observation used a deliberately fake, non-authorizing kernel bearer and format-only metadata to test model transport and OS startup. No kernel tool was requested. It is not delegated-kernel acceptance. The installed tree was a disposable copy with current source build overlaid, not a final release tarball.

`boundary-probe.json` records hostile Node process probes under that exact launched policy. The probe's effects and read controls were independently checked outside the sandbox:

- Actual operator and another host's configuration paths returned `EPERM`, including their `/System/Volumes/Data` aliases and a profile symlink to the operator file. Outside-sandbox controls could read those files; no credential values were retained.
- The own configuration and installed control file remained readable. Direct writes and attempts to hardlink them into the writable profile returned `EPERM`; independent hashes/content remained unchanged.
- Both `child_process.spawn(process.execPath, ...)` and `/bin/sh` returned `EPERM`.
- An unrelated localhost listener observed zero sandbox requests. The subsequent outside-sandbox positive control produced exactly one request.

The probe is operator-injected hostile process code, not a claimed model-prompt exploit. Its source is `scripts/probe-sandbox.mjs`. Retained failed startup variants show real missing-permission failures: normal-home lookup, directory lookup and a Node assertion after denied hostname lookup. Those failed variants are not accepted candidates. A reviewer caught the initial broad `/System` read rule and provider item-reference input gap; both were fixed before the successful current-policy probe.

`model-only-v7.jsonl` repeats actual model completion after adding first-use profile ownership. `unowned-profile.json` confirms an unmarked nonempty directory is refused before host startup and its independent control file remains unchanged. These are still model-only observations with the deliberately non-authorizing kernel configuration.

## Remaining work

Run the complete protected launcher with the actual delegated credential and resource-owner durable fence. Repeat useful work, denial, identity/scope, revocation/expiry/budget/approval, unknown/restart and independent resource observations against the final packaged combination. Mutable guest profile state is not a substitute for the kernel-owned dispatch state. The raw SDK/development CLI has no such OS boundary and is not the supported protected entrypoint.
