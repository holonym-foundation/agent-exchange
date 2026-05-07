{
  "name": "{{projectPkgName}}",
  "version": "0.0.1",
  "private": true,
  "description": "Cetus concentrated-liquidity yield agent on Sui — WaaP CLI",
  "type": "module",
  "scripts": {
    "dev": "tsx agent.ts",
    "start": "node --experimental-strip-types agent.ts",
    "compose:up": "docker compose up -d",
    "compose:logs": "docker compose logs -f agent",
    "compose:down": "docker compose down"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "dependencies": {
    "@cetusprotocol/cetus-sui-clmm-sdk": "^5.4.0",
    "@human.tech/waap-cli": "^1.0.0",
    "@mysten/sui": "^1.14.0",
    "bn.js": "^5.2.1",
    "dotenv": "^16.4.5",
    "execa": "^9.5.2"
  },
  "devDependencies": {
    "@types/bn.js": "^5.1.5",
    "@types/node": "^20.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.0.4"
  }
}
