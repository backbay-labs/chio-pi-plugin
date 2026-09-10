# Pi native static-kernel evidence

See [the qualification record](../../../docs/STATIC-KERNEL-QUALIFICATION.md) for
scope, exact identities, observations and remaining requirements. This collection
contains native Pi results on local static kernel `c03a8a711dbb...`; it is not a
published release or another host's acceptance record.

`files.json` maps each deterministic gzip object to its original source, byte
count and SHA256. Decompress once to recover the exact original bytes; source CI
log objects were already gzip files and therefore require a second decompression
to read their text. `credential-exclusion.json` records the selected-path scan.
The sibling Codex timing failure appears in the shared coordinator result and is
not silently removed. Pi itself completed 19 commands with zero skips and unchanged
runtime/driver identities.

The capacity pause/resume affects outer elapsed command values, which are not
latency measurements. Native interval samples ran after resumption. Completed
owner stop records preserve the authority and resource volume names.
