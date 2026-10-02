# Releasing create-agent-wallet

Merging a recipe changes the source registry, not the package already cached by npm.
The release is complete only when the exact public artifact has been verified.

## Release checklist

1. Confirm the intended version is identical in `package.json`, `package-lock.json`,
   `src/cli.ts`, and each new activity's compatible `minCliVersion`.
2. From this package directory, run `npm ci` and `npm run check` on Node.js 24+.
3. Run `npm pack --dry-run` and confirm `dist/registry.json` plus every activity
   template is included. No source-only or internal file should enter the tarball.
4. Publish with the organisation's normal npm provenance/2FA process.
5. In a fresh temporary directory, run:

   ```bash
   npx --yes @human.tech/create-agent-wallet@<version> \
     --activity cetus-yield-agent --runtime standalone \
     --no-session --yes cetus-smoke
   ```

6. Confirm `create-agent-wallet --version`, the activity version, generated dependency
   versions, safe defaults, and repository metadata all match the merged source.
7. Install and type-check the generated standalone project. Run its documented
   read-only smoke test before tagging the release as ready for DevRel.
8. Update the release notes with added/changed recipes and any migration requirement.

Do not promote an unpublished source recipe through the npm quick start. For a
rollback, deprecate the affected npm version and publish a corrected patch; do not
silently reuse a version number.

## Prepare the Builder Lab artifacts

Use the `npm release candidates` workflow on the intended main revision. It verifies both packages, the published WaaP profile contract, all standalone consumers, and the version reported by each installed CLI. It uploads the two tarballs with `release-manifest.json`, recording source revision/tree and SHA-256/SHA-512 integrity. The workflow has read-only repository permissions and **does not publish** or receive npm credentials. PR artifacts are review candidates; use a main-revision run for release.

For local preparation, start with a clean committed checkout, perform the checks above plus `npm run check:consumers`, and run the fleet checks/build. Then from the repository root:

```bash
node scripts/prepare-npm-release.mjs /tmp/aex-npm-release-candidate
```

The output directory must be new and outside the checkout. The script installs the tarballs in fresh temporary consumers and rejects a package/lock/installed-CLI version mismatch, wrong repository or forbidden file paths. It does not replace the repository secret guard, dependency review, signing-policy tests or live acceptance.

Before publishing, an authorised npm maintainer must verify scope ownership, version availability and artifact hashes. `npm whoami` checks the active identity; if absent, use `npm login` in the maintainer's own terminal and complete browser/2FA prompts. Never paste credentials or OTPs into issues or chat. Publish the reviewed artifact through the organisation's established process. If npm requests 2FA, complete the publish interactively; do not disable 2FA or add a long-lived release token to this repository.

[Trusted publishing](https://docs.npmjs.com/trusted-publishers/) can provide short-lived GitHub Actions authentication and automatic provenance after a maintainer configures the exact publishing workflow on npm. The candidate workflow is not a trusted publisher. Do not claim npm provenance for a locally published tarball merely because it has a hash manifest or was downloaded from CI. For a first package publication, confirm the organisation's bootstrap procedure before treating public lookup failure as permission to create it.

After publication, download each exact version from npm, compare its `dist.integrity` against the manifest, inspect the registry's provenance/signatures, and repeat the fresh generated-project and profile checks. Keep the source-only and published-install instructions distinct until this passes.

### Reproducible candidate builds

Release preparation sets `SOURCE_DATE_EPOCH` to the selected Git commit time, records it in the manifest and uses it for the bundled registry timestamp. Development builds without this variable retain a current build timestamp. Invalid explicit epochs fail rather than silently using the clock. The release script rebuilds and repacks each package twice and requires identical tarball bytes on that runner. Different platform compression implementations may produce different gzip bytes for identical tar contents; publish and verify the selected CI tarball itself instead of repacking it on another machine.
