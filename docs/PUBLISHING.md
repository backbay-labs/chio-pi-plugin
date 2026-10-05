# Publishing to npm

`.github/workflows/release.yml` publishes `@chio-protocol/pi-plugin` with npm
trusted publishing: its publish job exchanges its GitHub OIDC identity for a
short-lived publish token, so no npm token is stored anywhere. npm accepts a
trusted publisher only for a package that already exists, so the first version
is published once by hand. Every check in
[release qualification](RELEASE-QUALIFICATION.md) still applies.

## One-time bootstrap

You need an npm account that can publish to the `@chio-protocol` scope, with
two-factor authentication enabled, plus the GitHub CLI and
[`slsa-verifier`](https://github.com/slsa-framework/slsa-verifier).

1. **Qualify the release commit.** With CI green for that commit on `main`, run
   the release workflow by hand. A manual run builds, tests, qualifies the cold
   consumers and records SLSA provenance. It never publishes.

   ```sh
   gh workflow run release.yml --repo backbay-labs/chio-pi-plugin --ref main
   gh run list --repo backbay-labs/chio-pi-plugin --workflow release.yml --limit 1
   ```

2. **Download and verify the qualified archive.** Use the run ID from the
   previous command once the run has succeeded.

   ```sh
   gh run download RUN_ID --repo backbay-labs/chio-pi-plugin --name qualified-package --dir release
   gh run download RUN_ID --repo backbay-labs/chio-pi-plugin --name package.intoto.jsonl --dir release
   cd release
   shasum -a 256 -c SHA256SUMS
   slsa-verifier verify-artifact chio-protocol-pi-plugin-0.2.0.tgz \
     --provenance-path package.intoto.jsonl \
     --source-uri github.com/backbay-labs/chio-pi-plugin --source-branch main
   cat release-identity.json
   ```

   `SHA256SUMS` is the workflow's record of the archive digest, and the signed
   provenance binds that digest to this repository and run. Confirm that
   `release-identity.json` names the commit you intend to release, package
   `@chio-protocol/pi-plugin` and version `0.2.0`.

3. **Publish that exact file once.**

   ```sh
   npm login
   npm publish chio-protocol-pi-plugin-0.2.0.tgz --dry-run --ignore-scripts --access public
   npm publish chio-protocol-pi-plugin-0.2.0.tgz --ignore-scripts --access public
   ```

   npm asks for a one-time password. A hand publish carries no npm provenance
   attestation; versions the workflow publishes do.

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

6. **Create the `npm` environment.** In the GitHub repository, open
   **Settings**, **Environments** and add an environment named `npm`. Add
   required reviewers there if each release should wait for your approval.
   Tag builds refuse to publish until this environment exists.

Do not push a `v0.2.0` tag afterwards: that version exists, so the run's publish
step would fail. Tag-driven releases start with the next version.

## Every later release

1. Raise `version` in `package.json` and `package-lock.json` in a reviewed commit
   on `main`, and wait for its `ci` push run to succeed.
2. Tag that commit and push the tag:

   ```sh
   git tag -a v0.2.1 -m v0.2.1
   git push origin v0.2.1
   ```

3. Approve the run's `npm` environment deployment when GitHub asks for it. The
   workflow refuses a tag that does not match the package version, a commit
   outside `main` or without successful CI, or an archive whose identity
   differs. It then publishes the qualified tarball with provenance and
   attaches it to a GitHub Release.

## Requirements checked

Checked on 2026-10-05 against npm's
[trusted publishing guide](https://docs.npmjs.com/trusted-publishers) (last
edited 2026-09-30) and [`npm trust`](https://docs.npmjs.com/cli/v11/commands/npm-trust)
(last edited 2026-06-02):

- npm CLI 11.5.1 or later and Node 22.14.0 or later. The publish job pins npm
  11.8.0 on Node 22.19.0 and fails early otherwise.
- A GitHub-hosted runner and `id-token: write`, which the publish job has.
- `repository.url` in `package.json` must match the GitHub repository exactly;
  the build job enforces this.
- npm tries OIDC before any token, so `NODE_AUTH_TOKEN` is not needed.
- Provenance is automatic for a public package published from a public
  repository; the workflow also passes `--provenance`.
- `npm trust` states that the package must already exist on the registry, which
  is why the bootstrap above is needed.
