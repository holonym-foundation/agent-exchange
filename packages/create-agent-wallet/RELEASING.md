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
