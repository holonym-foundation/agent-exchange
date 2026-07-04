import { Command } from 'commander'
import pc from 'picocolors'
import {
  clearIntent,
  CONTRACTS_BY_CHAIN,
  contractsDeployed,
  defaultIdentityChain,
  recordIntent,
  statusDescription
} from '../core/erc8004.js'
import { FleetManager } from '../core/FleetManager.js'

export function erc8004Command(): Command {
  const erc = new Command('erc8004').description(
    'ERC-8004 Trustless Agents identity (Draft spec — v1.0.2 records intent, mints once contracts deploy)'
  )

  erc
    .command('register')
    .description('Record (or mint, once contracts deploy) an ERC-8004 Identity for an agent')
    .argument('<agent-id>', 'Agent to register')
    .option('--chain <chain>', 'Identity chain (defaults to the agent\'s chain — sepolia for EVM)')
    .option('--json', 'Emit result as JSON')
    .addHelpText(
      'after',
      `
Examples:
  $ aex-fleet erc8004 register alpha
  $ aex-fleet erc8004 register alpha --chain ethereum
  $ aex-fleet erc8004 status                        # all agents

Status meanings:
  pending — contracts not yet deployed → intent only, will mint once they are
  pending mint                          → contracts present, mint queued (v1.1+)
  minted                                → on-chain (tokenId stored in fleet.json)
  failed                                → last attempt errored (lastError in state)`
    )
    .action(async (agentId: string, opts: { chain?: string; json?: boolean }) => {
      const fm = new FleetManager()
      const agent = fm.getAgent(agentId)
      if (!agent) {
        console.error(pc.red(`Unknown agent: ${agentId}`))
        process.exit(2)
      }
      const intentChain = opts.chain ?? defaultIdentityChain(agent.chain)
      if (!intentChain) {
        console.error(
          pc.red(
            `Can't infer an ERC-8004 chain for agent.chain=${agent.chain}. Pass --chain explicitly.`
          )
        )
        process.exit(2)
      }
      const state = await recordIntent({ agentId, intentChain })
      if (opts.json) {
        console.log(JSON.stringify({ agentId, erc8004: state, statusDescription: statusDescription(state) }, null, 2))
        return
      }
      console.log(pc.green(`Recorded ERC-8004 intent for ${pc.bold(agentId)} on ${intentChain}.`))
      console.log(pc.dim(`  ${statusDescription(state)}`))
      if (!contractsDeployed(intentChain)) {
        console.log(
          pc.dim(
            `  (CONTRACTS_BY_CHAIN['${intentChain}'] is empty — populate src/core/erc8004.ts once Holonym/community deploys.)`
          )
        )
      }
    })

  erc
    .command('unregister')
    .description('Remove ERC-8004 intent/state from an agent (does NOT burn an on-chain token)')
    .argument('<agent-id>', 'Agent to clear')
    .option('--json', 'Emit result as JSON')
    .action(async (agentId: string, opts: { json?: boolean }) => {
      const fm = new FleetManager()
      const agent = fm.getAgent(agentId)
      if (!agent) {
        console.error(pc.red(`Unknown agent: ${agentId}`))
        process.exit(2)
      }
      const wasMinted = agent.erc8004?.status === 'minted'
      await clearIntent({ agentId })
      if (opts.json) {
        console.log(JSON.stringify({ agentId, cleared: true, hadMintedToken: wasMinted }, null, 2))
        return
      }
      console.log(pc.green(`Cleared ERC-8004 state for ${pc.bold(agentId)}.`))
      if (wasMinted) {
        console.log(
          pc.yellow(
            '  WARNING: this agent had a minted token. The NFT is NOT burned on-chain — manage via the registry directly if needed.'
          )
        )
      }
    })

  erc
    .command('status')
    .description('Show ERC-8004 status per agent')
    .argument('[agent-id]', 'Optional agent to scope to (defaults to all)')
    .option('--json', 'Emit result as JSON')
    .action((agentId: string | undefined, opts: { json?: boolean }) => {
      const fm = new FleetManager()
      const agents = agentId
        ? (fm.getAgent(agentId) ? [fm.getAgent(agentId)!] : [])
        : fm.listAgents()
      if (agents.length === 0) {
        console.error(pc.red(agentId ? `Unknown agent: ${agentId}` : 'No agents registered.'))
        process.exit(agentId ? 2 : 0)
      }
      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              contractsDeployedOn: Object.keys(CONTRACTS_BY_CHAIN),
              agents: agents.map((a) => ({
                agentId: a.agentId,
                erc8004: a.erc8004 ?? null,
                statusDescription: statusDescription(a.erc8004)
              }))
            },
            null,
            2
          )
        )
        return
      }
      const deployed = Object.keys(CONTRACTS_BY_CHAIN)
      if (deployed.length === 0) {
        console.log(pc.dim('No ERC-8004 contracts deployed in any chain yet. All registrations remain "pending".'))
        console.log()
      } else {
        console.log(pc.dim(`Contracts deployed on: ${deployed.join(', ')}`))
        console.log()
      }
      for (const a of agents) {
        const sym = a.erc8004?.status === 'minted' ? pc.green('●') : a.erc8004 ? pc.yellow('○') : pc.dim('·')
        console.log(`${sym}  ${pc.bold(a.agentId.padEnd(24))}  ${statusDescription(a.erc8004)}`)
      }
    })

  return erc
}
