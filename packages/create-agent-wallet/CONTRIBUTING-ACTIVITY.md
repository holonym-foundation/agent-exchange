# Contributing an AEX recipe

An AEX recipe is a reproducible agent activity that drives a specific, observable
action on a chain or application. It is more than a prompt: another developer must be
able to scaffold it, understand its risk, run it safely, and reproduce its outcome
without private context.

Community and partner contributions are welcome now. Open an issue before doing a
substantial port so maintainers can agree on the activity, success signal, and review
owner before code is written.

## Recipe lifecycle

1. **Propose** — name the chain/app, user outcome, measurable activity, external
   dependencies, and the smallest safe read-only or simulation proof.
2. **Build** — add one `registry/activities/<slug>/` directory with its manifest,
   public guide, and runtime templates. Copy the closest existing activity to start.
3. **Validate** — run the repository gate and record a safe-mode smoke test.
4. **Review** — reviewers check reproducibility, transaction safety, observability,
   dependency provenance, and public-repo hygiene.
5. **Verify** — maintainers set `verified: true` only after reproducing the smoke test.
6. **Release** — merge the recipe, publish a new CLI version, and verify the exact npm
   artifact. A merged recipe is not self-serve until the package containing it is live.

## Quality bar

A recipe is ready when all of these are true:

- **Specific:** it names the action and the resulting chain/app activity. “Research
  DeFi” is not a recipe; “monitor and rebalance a Cetus SUI/USDC CLMM position” is.
- **Reproducible:** prerequisites, supported network, identifiers, setup, expected
  output, and failure recovery are documented using public information.
- **Safe by default:** startup is read-only or simulated. Any money-moving mode is an
  explicit opt-in with a positive hard cap, documented allowlists/policies, and a
  clear simulation-to-live sequence.
- **Observable:** structured output shows decisions, submitted transaction digests,
  failures, and enough state to verify the action independently.
- **Replicable:** no operational wallet, hosted AEX service, internal hostname,
  private ticket, or maintainer-only skill is required.
- **Maintainable:** dependencies are pinned to supported major versions; generated
  standalone code type-checks; recovery behavior and known limitations are explicit.
- **Attributable:** imported work retains authorship/history, and all submitted code
  has a compatible license and DCO sign-off.

## Directory layout

```text
registry/activities/<slug>/
├── activity.json
├── README.md
├── HISTORY.md                 # required for imported/extracted work
└── templates/
    ├── standalone/
    ├── claude/
    ├── openclaw/
    └── nous/
```

Every runtime listed in `activity.json` must have a matching template directory.
Template-class activities currently ship all four supported runtimes so a recipe is
portable across code-first and agent-skill workflows.

## Template file conventions

| Convention | Result |
| --- | --- |
| `foo.tpl` | Substitute variables and output as `foo` |
| `dot-foo` | Copy byte-for-byte and output as `.foo` |
| `dot-foo.tpl` | Substitute variables and output as `.foo` |
| any other file | Copy byte-for-byte |

Available variables are `projectName`, `projectPkgName`, `chainId`, `chainName`,
`walletAddress`, `cliVersion`, and `recipeUrl`. Claude templates also receive
`activityName` and `activityDescription`. An undefined variable fails scaffolding.

## Manifest contract

The authoritative Zod schema is [`src/registry/types.ts`](./src/registry/types.ts).
Important rules:

- `slug` is lowercase kebab-case and exactly matches its directory name.
- `version` and `minCliVersion` are semantic versions.
- `chain.id` is a positive integer or `null` for a chain-agnostic activity.
- `runtimes` is a non-empty subset of `claude`, `standalone`, `openclaw`, and `nous`.
- every environment key is `UPPER_SNAKE_CASE` and describes whether it is required.
- contributors submit new recipes with `verified: false`; maintainers flip it after
  reproducing the smoke test.
- `recipeUrl` may be `null` while the public tutorial is being prepared. Do not link
  an internal document.
- declare every WaaP capability the recipe invokes in `waapFeatures`.

For money-moving recipes, include a required positive cap such as
`AGENT_MAX_DEPOSIT_USD` or `AGENT_MAX_ORDER_USD`. The implementation must refuse to
start in live mode when the cap is absent or invalid.

## Validate locally

Use Node.js 24+ and npm:

```bash
cd packages/create-agent-wallet
npm ci
npm run check
```

`npm run check` type-checks the CLI, runs the tests, builds the publishable registry,
and scaffolds every declared runtime for every recipe. During iteration, validate only
one recipe:

```bash
npm run validate:activity -- cetus-yield-agent
```

For a standalone recipe, also install and type-check the generated project:

```bash
node dist/index.js --activity cetus-yield-agent --runtime standalone \
  --no-session --yes /tmp/cetus-recipe-check
cd /tmp/cetus-recipe-check
npm install
npm run type-check
```

Then run the documented monitor/simulation smoke test. Never use contributor or
maintainer funds for an unreviewed live-mode test.

## PR evidence

The pull request must include:

- the user outcome and chain/app activity it creates;
- commands used for validation;
- safe-mode smoke-test date, network, public target identifier, and expected output;
- transaction policy/caps for live mode, or an explicit statement that it is
  permanently read-only;
- known limitations and failure/recovery behavior;
- provenance and history mapping for imported work;
- confirmation that every linked prerequisite and guide is publicly accessible.

The PR template turns these into a reviewer checklist.

## EIP-8004 metadata

The optional `eip8004` block describes supported trust models and public services.
Service endpoints may contain `{{host}}` and `{{walletAddress}}`; generated files leave
deployment-dependent values as explicit `__TODO_*__` placeholders. A recipe does not
claim on-chain registration merely because it emits the registration document.
