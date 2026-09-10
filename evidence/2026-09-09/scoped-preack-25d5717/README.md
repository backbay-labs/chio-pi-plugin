# Historical scoped Pi transcript

These three files preserve an earlier worker's transcript and run metadata,
previously referenced by [the acceptance history](../../../docs/ACCEPTANCE.md).
They were copied byte-for-byte from the original checkout on 2026-09-10; the
originals remain untouched. No host was rerun when retaining this collection.

| Recorded component | Historical identity |
| --- | --- |
| Pi integration source | `d5197a752132ff935393a7096adeaee93d5bfa1b` |
| Kernel source | `25d5717a5bcfd228391dbeee61d8d57f3c5e6177` |
| Kernel binary SHA256 | `d0b87623cb3dd227f79cd3178b32bb04e35b48ddcb9dab63c6598d79b8e13b66` |
| Recorded bridge SHA256 | `68b5c46638449710e3251f41aa1317f364c24138ae6cba3f45aeea51960ef3ff` |
| Resource image | `sha256:188cb84d5d0bb4063d4ce5a3b9c3832445a5acda5604911cda80a9136d1850a0` |
| Provider/model in transcript | `openai-responses`, `openai`, `gpt-4.1-mini` |
| Installation | Disposable source-overlay candidate, not a final packed artifact |

The transcript records a requested write/read workflow and reported tool results.
The recorded process exit is zero and stderr is empty. This collection does not
establish current acceptance, independently reverify resource effects, qualify a
shipped artifact, or prove downstream response-loss protection. Its original
scope limitation in `run.json` remains unchanged. Current artifact-specific
observations are recorded [separately](../../../docs/STATIC-KERNEL-QUALIFICATION.md).

The credential/private-data review found no credential fields, no matches to six
available credential values, and no private-key, API-key, GitHub-token, bearer,
JWT or email-address pattern matches. The retained content consists of scripted
test text, tool outputs, public receipt fields, usage metadata and local test
paths. No private profiles, gateway configurations or databases are included.

Verify the original bytes from this directory:

```sh
shasum -a 256 -c SHA256SUMS
```
