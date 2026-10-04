# Task 1 implementation evidence

Scope: Pi 1.0.2 and the immutable typed registry, including protected parent,
guest transport, native dispatcher and model relay. Independent spec and quality
reviews follow the implementation commit. This record is component/stock-host
evidence, not a new native-kernel qualification.

## RED observed before implementation

* `npm run build && node --test test/tool-registry.test.mjs`: six failures because
  the typed registry factory was absent.
* `node --test --test-name-pattern='typed|Pi 1.0.2|private gateway inventory|relay binds' test/host-contract.test.mjs test/http-executor.test.mjs test/typed-relay.test.mjs`:
  seven failures. The dispatcher still exposed `chio_execute`; a wrapper could
  dispatch under typed options; same-name schema substitution was accepted; the
  registry and typed relay contracts were missing.
* `node --test test/configured.test.mjs`: prepared inventory lacked the typed
  snapshot and the configured executor lacked its registry binding.
* `node --test --test-name-pattern='trusted parent|typed approval' test/configured.test.mjs test/http-executor.test.mjs`:
  trusted parent host binding was absent; approval resume accepted malformed
  underlying resource arguments.
* Focused native prompt assertion failed while full schemas were duplicated in
  typed system context. Focused array-accessor test failed while a schema array
  getter could run during canonicalization. Both now pass.

## GREEN on implementation tree

`npm run typecheck && npm test && git diff --check` passes: 43 tests, zero failures,
zero skips. Coverage includes actual Pi dispatcher/callable tools, unknown aliases,
strict original arguments despite native coercion, poisoned resource discovery,
schema/name/description/mode resume bindings, full verified gateway outcomes,
typed approval native history, declaration/choice/history refusal before relay
egress, signed transport substitution and retained uncertainty regressions.

`npm ls @earendil-works/pi-ai @earendil-works/pi-coding-agent @earendil-works/pi-agent-core @earendil-works/pi-codemode @earendil-works/pi-mcp --all`
confirms 1.0.2 throughout the installed Pi graph. The host peer and CI consumer
also pin 1.0.2. Package-lock SHA-256:
`995a81158e0bf6fdf1df8b3afeece0eda8ca19629fddf2f97b445062d2a82d0c`.

Protected history observation precedes parent ACK. The unprotected programmatic
comparison interlock retains its earlier local-journal retention/ACK behavior;
it is not the protected native-history profile. See [typed tool contracts](../../TYPED-TOOLS.md).

No historical qualification/evidence file, normal Pi profile or credential cache
was modified. Real-kernel, model-provider, confinement and semantic-profile
acceptance remain separate. No PR or later roadmap task was implemented here.
