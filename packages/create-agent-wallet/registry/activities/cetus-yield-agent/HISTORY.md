# Cetus Yield Agent history

This activity was extracted from the archived `holonym-foundation/aex-legacy`
repository and relocated from `agents/cetus-yield-agent/` to its public registry
path. The extraction retains the original authors, dates, commit messages, DCO
trailers, and commit ordering. Commit hashes changed because the path was rewritten
and private deployment references were generalized before publication.

| Archived commit | Public-history commit | Author | Contribution |
|---|---|---|---|
| `d1e71a2` | `8b50af8` | lebraat (work) | Initial four-runtime activity, based on Muzz's TypeScript scaffold from Silk #859 and the working Cetus implementation |
| `8164e5e` | `382fe0a` | lebraat (work) | Runtime dependency and WaaP address-resolution fixes |
| `5d60dd6` | `d430e1d` | lebraat (work) | Set the Cetus SDK sender before building transaction payloads |
| `28e61b6` | `f4c622d` | lebraat (work) | PID-file supervision and implementation alignment |
| `677c373` | `3ff00d1` | lebraat (work) | Canonical-source documentation correction |
| merge of the preceding recovery PR | `8c54140` | Daniel \| human.tech | Preserved merge point |
| `11b3c1b` | `3153b9a` | Randy Pen | Extracted the pure volatility/range strategy |
| `a1516b3` | `77148c0` | Randy Pen | Transaction finality checks and crash-state reconciliation |
| `c1a38af` | `d61fa21` | Randy Pen | Sui gRPC transaction simulation (`DRY_RUN`) |
| `8c53bd2` | `160d9b7` | Randy Pen | Migrated to the Sui v2 and Cetus CLMM v1.4 SDKs |

Run this from the repository root to inspect the retained history:

```bash
git log --follow -- packages/create-agent-wallet/registry/activities/cetus-yield-agent
```

Operational deployment files were deliberately excluded. They are not required to
build, run, review, or contribute to the public recipe.
