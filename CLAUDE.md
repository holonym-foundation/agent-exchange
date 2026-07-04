# CLAUDE.md

Guidance for coding agents working in this repository.

## Read CONTRIBUTING.md first

Before making changes, follow [CONTRIBUTING.md](./CONTRIBUTING.md). It is the
source of truth for contribution workflow, commit conventions (including DCO
sign-off via `git commit -s`), the activity-slug naming convention, code style,
and tests.

## Pre-commit security review

This repo enables a tracked pre-commit hook via `git config core.hooksPath .githooks`
(see the "Local setup" section in [CONTRIBUTING.md](./CONTRIBUTING.md)). The hook
runs a security review of staged changes before every commit — including commits
you make — so expect `git commit` to invoke it. If a commit is blocked, address
the reported issue rather than reflexively passing `--no-verify`.
