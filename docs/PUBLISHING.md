# Publishing to npm

`.github/workflows/release.yml` publishes `@chio-protocol/pi-plugin` with npm
trusted publishing: its publish job exchanges its GitHub OIDC identity for a
short-lived publish token, so no npm token is stored anywhere. npm accepts a
trusted publisher only for a package that already exists, so the first version
is published once by hand. Every check in
[release qualification](RELEASE-QUALIFICATION.md) still applies.

## One-time bootstrap

You need an npm account that can publish to the `@chio-protocol` scope, with
two-factor authentication enabled, admin access to the GitHub repository, plus
the GitHub CLI, `openssl` and
[`slsa-verifier`](https://github.com/slsa-framework/slsa-verifier).

1. **Qualify the release commit.** With CI green for that commit on `main`, run
   the release workflow by hand. A manual run builds, tests, qualifies the cold
   consumers and records SLSA provenance. It never publishes. Then select the
   run for that exact commit:

   ```sh
   COMMIT=$(git rev-parse origin/main)   # the reviewed commit to release
   gh workflow run release.yml --repo backbay-labs/chio-pi-plugin --ref main
   gh run list --repo backbay-labs/chio-pi-plugin --workflow release.yml \
     --event workflow_dispatch --json databaseId,headSha,createdAt,status,conclusion \
     --jq ".[] | select(.headSha == \"$COMMIT\")"
   ```

   Use the `databaseId` of the newest entry whose `headSha` equals `$COMMIT`,
   once its `conclusion` is `success`. If no entry matches, `main` moved: start
   again with the commit you mean to release.

2. **Download and verify the qualified archive.**

   ```sh
   gh run download RUN_ID --repo backbay-labs/chio-pi-plugin --name qualified-package --dir release
   gh run download RUN_ID --repo backbay-labs/chio-pi-plugin --name package.intoto.jsonl --dir release
   cd release
   shasum -a 256 -c SHA256SUMS
   slsa-verifier verify-artifact chio-protocol-pi-plugin-0.2.0.tgz release-identity.json \
     --provenance-path package.intoto.jsonl \
     --source-uri github.com/backbay-labs/chio-pi-plugin --source-branch main
   cat release-identity.json
   ```

   The signed provenance covers both files, so `release-identity.json` is
   trusted through it rather than through the unsigned `SHA256SUMS`. Confirm
   that the commit on the verifier's "at commit" line, the `source` in
   `release-identity.json` and `$COMMIT` are the same, and that the identity
   names package `@chio-protocol/pi-plugin` and version `0.2.0`.

3. **Publish that exact file once, then compare.**

   ```sh
   npm login
   npm publish chio-protocol-pi-plugin-0.2.0.tgz --dry-run --ignore-scripts --access public
   npm publish chio-protocol-pi-plugin-0.2.0.tgz --ignore-scripts --access public
   npm view @chio-protocol/pi-plugin@0.2.0 dist.integrity
   echo "sha512-$(openssl dgst -sha512 -binary chio-protocol-pi-plugin-0.2.0.tgz | openssl base64 -A)"
   ```

   npm asks for a one-time password. The two integrity lines must be identical.
   A hand publish carries no npm provenance attestation; versions the workflow
   publishes do.

4. **Add the trusted publisher.** On npmjs.com, open the package's
   **Settings**, find **Trusted Publisher** and choose **GitHub Actions**:

   | Field | Value |
   | --- | --- |
   | Organization or user | `backbay-labs` |
   | Repository | `chio-pi-plugin` |
   | Workflow filename | `release.yml` |
   | Environment name | `npm` |
   | Allowed actions | `npm publish` |

   Every field is case-sensitive, and npm does not check them when you save, so
   a typo appears only as a failed publish. The workflow publishes directly,
   which is why `npm publish` must be allowed. With npm 11.15.0 or later, the
   same setting is
   `npm trust github @chio-protocol/pi-plugin --file release.yml --repository backbay-labs/chio-pi-plugin --environment npm --allow-publish`.

5. **Close the token path.** npm recommends setting **Settings**, **Publishing
   access** to "Require two-factor authentication and disallow tokens", then
   revoking automation tokens you no longer need. Trusted publishing keeps
   working. Run `npm logout` when done.

6. **Protect the `npm` environment (required).** In the GitHub repository open
   **Settings**, **Environments**, **New environment**, name it `npm`, then:
   - under **Deployment protection rules**, tick **Required reviewers** and add
     the people or team who approve releases (leave **Prevent self-review** off
     if a reviewer also pushes the tag);
   - under **Deployment branches and tags**, choose **Selected branches and
     tags**, **Add deployment branch or tag rule**, ref type **Tag**, name
     pattern `v*.*.*`;
   - **Save protection rules**.

   The same with the GitHub CLI:

   ```sh
   REVIEWER_ID=$(gh api users/YOUR_GITHUB_LOGIN --jq .id)
   gh api --method PUT repos/backbay-labs/chio-pi-plugin/environments/npm --input - <<JSON
   {"wait_timer": 0, "prevent_self_review": false,
    "reviewers": [{"type": "User", "id": $REVIEWER_ID}],
    "deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}
   JSON
   gh api --method POST repos/backbay-labs/chio-pi-plugin/environments/npm/deployment-branch-policies \
     -f name='v*.*.*' -f type=tag
   gh api repos/backbay-labs/chio-pi-plugin/environments/npm \
     --jq '[.protection_rules[].type], .deployment_branch_policy'
   ```

   For a team, use `{"type": "Team", "id": TEAM_ID}` with
   `gh api orgs/backbay-labs/teams/TEAM_SLUG --jq .id`. The last command must
   list `required_reviewers` and show `custom_branch_policies: true`. Tag builds
   refuse to publish until this environment exists.

7. **Restrict release tags (required).** Open **Settings**, **Rules**,
   **Rulesets**, **New ruleset**, **New tag ruleset**. Name it `release tags`,
   set **Enforcement status** to **Active**, add the roles, teams or people
   allowed to cut releases under **Bypass list**, then under **Target tags**
   choose **Add target**, **Include by pattern**, `v*`. Tick **Restrict
   creations**, **Restrict updates** and **Restrict deletions**, then
   **Create**. The same with the GitHub CLI, letting organization admins
   bypass:

   ```sh
   gh api --method POST repos/backbay-labs/chio-pi-plugin/rulesets --input - <<'JSON'
   {"name": "release tags", "target": "tag", "enforcement": "active",
    "bypass_actors": [{"actor_type": "OrganizationAdmin", "actor_id": 1, "bypass_mode": "always"}],
    "conditions": {"ref_name": {"include": ["refs/tags/v*"], "exclude": []}},
    "rules": [{"type": "creation"}, {"type": "update"}, {"type": "deletion"}]}
   JSON
   ```

   To let a release manager or team bypass instead, list
   `{"actor_type": "User", "actor_id": USER_ID, "bypass_mode": "always"}` or
   `{"actor_type": "Team", "actor_id": TEAM_ID, "bypass_mode": "always"}`.

Steps 6 and 7 are not optional. npm's trusted publisher binds the owner,
repository, workflow filename and environment, not the Git ref, and the gates
in `release.yml` live in the same file a tagged commit can change. Without them,
anyone with write access could push a `v*` tag on a commit outside `main` whose
`release.yml` drops those gates. Because the trusted publisher names the `npm`
environment, GitHub's required reviewers and tag policy apply to every publish
whatever that file says, and the ruleset limits who can create the tag at all.

Do not push a `v0.2.0` tag afterwards: that version exists, so the run's publish
step would fail. Tag-driven releases start with the next version.

## Every later release

1. Raise `version` in `package.json` and `package-lock.json` in a reviewed commit
   on `main`, and wait for its `ci` push run to succeed.
2. As someone the tag ruleset allows, tag that commit and push the tag:

   ```sh
   git tag -a v0.2.1 -m v0.2.1
   git push origin v0.2.1
   ```

3. A required reviewer approves the run's `npm` environment deployment, after
   confirming that the run is for that tag and that its commit is the reviewed
   `main` commit. Nothing publishes without that approval. The workflow also
   refuses a tag that does not match the package version, a commit outside
   `main` or without successful CI, or an archive whose identity differs. It
   then publishes the qualified tarball with provenance and attaches it to a
   GitHub Release.

## Requirements checked

Checked on 2026-10-05 against npm's
[trusted publishing guide](https://docs.npmjs.com/trusted-publishers) (last
edited 2026-09-30) and [`npm trust`](https://docs.npmjs.com/cli/v11/commands/npm-trust)
(last edited 2026-06-02), GitHub's REST references for
[environments](https://docs.github.com/en/rest/deployments/environments),
[deployment branch and tag policies](https://docs.github.com/en/rest/deployments/branch-policies)
and [rulesets](https://docs.github.com/en/rest/repos/rules), and the pinned
`actions/setup-node` source:

- npm CLI 11.5.1 or later and Node 22.14.0 or later. The publish job pins npm
  11.8.0 on Node 22.19.0 and fails early otherwise.
- A GitHub-hosted runner and `id-token: write`, which the publish job has.
- `repository.url` in `package.json` must match the GitHub repository exactly;
  the build job enforces this.
- npm tries OIDC before any token, so `NODE_AUTH_TOKEN` is not needed. The
  pinned `actions/setup-node` exports the placeholder `XXXXX-XXXXX-XXXXX-XXXXX`
  when it is unset; the publish job refuses any other value.
- Provenance is automatic for a public package published from a public
  repository; the workflow also passes `--provenance`.
- `npm trust` states that the package must already exist on the registry, which
  is why the bootstrap above is needed.
- A deployment tag policy needs `custom_branch_policies: true` on the
  environment; ruleset bypass for `OrganizationAdmin` ignores `actor_id`.
