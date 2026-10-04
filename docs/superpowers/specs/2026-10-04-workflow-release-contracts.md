# Development workflow and release contracts

This refines Tasks 7 and 8. It describes acceptance for the new candidate,
without transferring the frozen kernel qualification to another artifact.

## One useful development task

Use a small expiration-boundary bug: `isExpired(now, deadline)` initially uses
`now > deadline`; the intended behavior uses `now >= deadline`. The first real
confined test must fail at equality. Locate and read the source through admitted
resource tools, apply a compare-and-swap patch, run the same pinned recipe,
inspect the resulting diff, and publish the exact successfully tested artifact.

An independent observer checks source and artifact contents and counts actual
publication effects. Retain the exact source, recipe, test result, patch,
destination and artifact bindings. A second actual host instance must recover the
original result without another publication. Include forbidden resource access
followed by legitimate work under the same retained authority.

Keep the evidence layers explicit:

- A resource refusal known before effects may be a retained completed tool error.
  It is distinct from a native signed denial, which preserves its native fence.
- A scripted executor or signed bridge fixture measures the adapter and host
  contracts. It does not qualify a real kernel or authority installation.
- Response loss after the native gateway has retained the signed completion may
  be reconciled from that original completion. Resource commit before native
  completion evidence is retained remains an unknown original operation.
- Actual native coding-workflow acceptance stays open until the exact kernel,
  publisher manifest, custody/launch profile, caller binding and signed recovery
  fixture listed in native prerequisites are supplied and qualified.

Ship a runnable qualification command and fixture, with independent checks and
explicit refusal when a required native profile is unavailable. Preserve failures
and uncertainty; never replace an uncertain publication to make the demo finish.

## Twelve-row implementation crosswalk

Document each original research idea with shipped entrypoints, current component
or host evidence, native acceptance prerequisites, and remaining limitations:

1. Typed native tools.
2. Trusted operator console.
3. Constrained coding workspace.
4. Pi 1.0.2 compatibility lane.
5. Governed repository context.
6. Explanations and authorized continuations.
7. Pi Durable adapter.
8. Model context and labeled artifact governance.
9. Cross-host original-operation continuation.
10. Bounded native delegation.
11. Governed codemode and bounded aggregation.
12. Parent run limits and portable confinement.

An interface or unavailable gate is not a qualified native feature. Explain that
arbitrary codemode remains disabled and bounded `read_many` is the implemented
aggregate alternative. Keep current qualification links pointed to
`FINAL-QUALIFICATION.md`, identify its frozen artifact scope, and preserve all
historical evidence files. Update runnable commands to the new candidate and
Pi 1.0.2 without rewriting old qualification records.

## Candidate and cold consumers

Use candidate version `0.2.0` for the changed adapter surface. Keep the frozen
`0.1.0` evidence and hashes unchanged. Build the new candidate from a clean,
reviewed commit, bundle the unpublished bridge and its required production
dependencies, and leave the source package metadata unchanged during packing.
Include every new binary and export, all runtime Unicode data and license, and
the optional Durable entrypoint.

Install the archive in two fresh consumers with separate empty npm caches:

- Base consumer: exact Pi 1.0.2, no Pi Durable package. Import the root and coding
  entrypoints, typecheck the root declarations without optional Durable types,
  and run every installed binary's help path.
- Durable consumer: exact Pi 1.0.2 and exact optional Pi Durable 1.0.2. Import and
  typecheck the dedicated Durable entrypoint and exercise its registration smoke.

Use isolated home and Pi profile directories. The smoke must not read or modify
the user's normal Pi profile or require real provider credentials. Exercise npm
executable symlinks and verify export/bin containment and staged package metadata.

Retain each actual consumer lockfile and its digest, plus the resolved dependency
graph, artifact hash, source commit, Node/npm/platform identities and installation
commands. Pinning an exact peer alone does not freeze Pi's transitive graph. Use a
relative local artifact dependency in the retained consumer fixture, rather than
a machine-specific temporary absolute path. Keep consumer provenance outside
packaged `docs/` to avoid an artifact self-hash cycle. Builder-lock provenance and
consumer-lock provenance are separate records.

Verify the minimum supported Node 22.19.0 with the new package, rather than
inferring it from Node 22.23.1 or Node 25.5.0. Ship reproducible pinned Linux
qualification instructions and record any privileged outer-container requirement
separately from ordinary Linux or native P5 qualification. CI should retain the
candidate and consumer evidence, run appropriate component checks, and use only
dry-run publication.

## Review and PR delivery

Review the complete range from the retained main base, fix valid findings with
focused regressions, then use a fresh final reviewer. After remaining fixes,
run fresh typecheck, all appropriate tests, release packing and both cold-consumer
checks on the final reviewed commit. Verify a clean isolated worktree and the
preserved dirty primary checkout. Check conventional commits, new prose without
em dashes, the full crosswalk, and absence of credentials in committed artifacts.

Push the authorized branch and open a PR against main. Verify its exact head and
report hosted checks from the live PR separately from local evidence. Do not
merge or publish the package as part of this task.
