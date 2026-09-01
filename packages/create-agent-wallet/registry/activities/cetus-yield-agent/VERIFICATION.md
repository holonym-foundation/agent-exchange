# Cetus recipe verification

Verified on 2026-09-01 against the public Sui mainnet SUI/USDC Cetus pool:

```text
0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105
```

## Reproduced checks

- `npm run check` passes for `create-agent-wallet`: type-check, tests, registry build,
  and all four runtime scaffolds.
- The generated standalone project installs and type-checks.
- Production dependency audit for the generated standalone project reports no known
  vulnerabilities.
- Monitor mode reads the pool through Sui gRPC, reports tick `72300`, emits a simulated
  position (`tickLower=72120`, `tickUpper=72480`), completes its yield scan, schedules
  the next cycle, and shuts down cleanly on SIGINT.
- Active mode refuses to start when `AGENT_MAX_DEPOSIT_USD` is missing or non-positive.
  Planned opens value both SUI and USDC legs at the pool price and reject total value
  above the cap; a non-SUI/USDC pool is rejected.
- The source history and combined public history pass the repository guard and secret
  scan.

The mainnet smoke test was read-only. It required no WaaP wallet and submitted no
transaction.

## Not yet claimed

- No mainnet position was opened or rebalanced with maintainer funds from this public
  release candidate.
- The active `DRY_RUN=true` path still needs a funded test wallet to reproduce the
  complete remove/open transaction simulation against current chain state.
- Strategy output is not a promise of yield, profit, uptime, or protection from smart
  contract, oracle, liquidity, RPC, or market risk.

Before promoting active mode, record a funded simulation with transaction effects and
gas, then a deliberately capped live canary. Never place credentials, wallet addresses,
or operational deployment details in this repository when recording that evidence.
