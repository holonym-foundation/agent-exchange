# Contributing an Activity

Curated (Holonym-only) for v1; community PRs welcome for v2. Treat this as an internal spec until the marketplace opens.

## Directory layout

```
registry/activities/<slug>/
├── activity.json          # required — metadata
├── README.md              # required — human description
└── templates/
    ├── standalone/        # required if "standalone" ∈ runtimes
    │   ├── package.json.tpl
    │   ├── agent.ts.tpl
    │   ├── Dockerfile
    │   ├── tsconfig.json
    │   ├── dot-env.example
    │   ├── dot-gitignore
    │   └── README.md.tpl
    └── claude/            # required if "claude" ∈ runtimes
        ├── SKILL.md.tpl
        ├── CLAUDE.md.tpl
        ├── mcp-config.json.tpl
        ├── dot-env.example
        └── README.md.tpl
```

## Template file conventions

| Convention     | Meaning                                                                               |
| -------------- | ------------------------------------------------------------------------------------- |
| `foo.tpl`      | `foo.tpl` is processed with variable substitution, output as `foo`                    |
| `dot-foo`      | Output as `.foo` (for dotfiles; keeps tooling from treating source as a real dotfile) |
| `dot-foo.tpl`  | Both — processed with vars **and** output as `.foo`                                   |
| Any other file | Copied byte-for-byte                                                                  |

## Template variables

Always available:

| Variable             | Value                                                   |
| -------------------- | ------------------------------------------------------- |
| `{{projectName}}`    | User's chosen directory name                            |
| `{{projectPkgName}}` | Same as `projectName` (npm-safe already)                |
| `{{chainId}}`        | Chain id from `activity.json` (empty string for `any`)  |
| `{{chainName}}`      | Chain name from `activity.json`                         |
| `{{walletAddress}}`  | Detected wallet address, or `__PENDING__` if no session |
| `{{cliVersion}}`     | create-agent-wallet version                             |
| `{{recipeUrl}}`      | `activity.json:recipeUrl` or empty                      |

Claude runtime additionally provides:

| Variable                  | Value                       |
| ------------------------- | --------------------------- |
| `{{activityName}}`        | `activity.json:name`        |
| `{{activityDescription}}` | `activity.json:description` |

Referencing an undefined variable throws at scaffold time — keep templates honest.

## activity.json schema

See [`src/registry/types.ts`](./src/registry/types.ts) for the Zod schema. Key rules:

- `slug` must be kebab-case **and** match the directory name
- `version` must be semver (`x.y.z`)
- `runtimes` must be a non-empty subset of `["claude", "standalone"]`
- `envVars[].key` must be `UPPER_SNAKE_CASE`
- `chain.family` ∈ `{"evm", "sui", "solana", "stellar", "any"}`
- `chain.id` must be a positive integer or `null` (only `any` family permits null)

## Validating locally

```bash
pnpm build:registry
# Fails loudly with schema errors per activity
```

## Smoke-testing your templates

```bash
pnpm build
node dist/index.js \
  --activity <your-slug> \
  --runtime standalone \
  --no-session \
  --registry file://$PWD/dist/registry.json \
  --yes \
  /tmp/test-scaffold
ls /tmp/test-scaffold
rm -rf /tmp/test-scaffold
```

## Paired recipe

Every Activity should pair with a full tutorial recipe at `docs.waap.xyz/recipes/<slug>`. Set `recipeUrl` in `activity.json` once the recipe is published.

If no recipe exists yet, set `recipeUrl: null` and open a DevRel ticket.

## EIP-8004 metadata (optional)

If your activity has a meaningful on-chain presence, add an `eip8004` block to `activity.json`:

```jsonc
"eip8004": {
  "supportedTrust": ["tee-attestation", "reputation"],
  "x402Support": false,
  "services": [
    {
      "type": "A2A",
      "endpointTemplate": "https://{{host}}/a2a",
      "version": "0.1",
      "skills": ["prediction-market-trading"],
      "domains": ["polymarket.com"]
    },
    {
      "type": "MCP",
      "endpointTemplate": "stdio://@human.tech/waap-mcp",
      "skills": [],
      "domains": []
    }
  ]
}
```

The scaffold engine reads this and emits a complete `agent-registration.json` in the generated project (plus `.well-known/agent-registration.json` for standalone runtime). The file matches the [EIP-8004 registration-v1](https://eips.ethereum.org/EIPS/eip-8004#agent-registration-file) format and is ready for the developer to upload to IPFS or serve from their host.

### Supported values

- `supportedTrust`: any subset of `["reputation", "crypto-economic", "tee-attestation"]`. If omitted, defaults to `["tee-attestation"]` (WaaP's 2PC + TEE model).
- `services[].type`: one of `web | A2A | MCP | OASF | ENS | DID | email`.
- `endpointTemplate`: may use `{{host}}` and `{{walletAddress}}`. `{{host}}` is always emitted as `__TODO_HOST__` for the developer to fill in post-deploy.

### Omitting the block

If omitted, the scaffold engine still emits a valid `agent-registration.json` with runtime-appropriate defaults (MCP service for Claude, A2A for standalone).
