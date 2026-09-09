# Capability and credential revocation observations

An actual native host with the actual OpenAI provider performed one useful write. The operator revoked that exact capability. A second native write attempt received a verified kernel denial mentioning revocation; independent resource and dispatch observations remained unchanged. The operator then revoked the session credential, and a new launcher refused before starting the host. This last case is explicitly recorded as launchPreflightRefused with no native call.

The first harness demanded a native tool call even when startup was correctly refused; its failed coverage record is retained. The revised harness distinguishes preflight refusal from actual host execution and still requires an exact native call for capability revocation. No fresh authority was issued to resume the revoked session.

These are bounded cases, not complete I05 or I08 acceptance. Revocation while an already-running host is between calls remains untested by this record.
