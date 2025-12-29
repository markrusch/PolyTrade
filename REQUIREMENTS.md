# Requirements

## Runtime
- Node.js v18 or later
- npm v9 or later

## Environment Variables (.env)
- `POLYMARKET_USER_ADDRESS`: User wallet address (0x- prefixed)
- `SAFE_ADDRESS`: Safe wallet address (if applicable)
- `FUNDER_ADDRESS`: Proxy/funder address for signature types 1/2
- `PRIVATE_KEY`: Wallet private key used for signing
- `POLYMARKET_CORE_API_URL`: Base URL for Core Data API (default: https://data-api.polymarket.com)

## Network
- Polygon mainnet (chain id 137)
- Recommended RPC: `https://polygon-rpc.com` (or your provider)

## Dependencies
Managed via package.json:

Exact versions currently used:

- @polymarket/builder-relayer-client: ^0.0.8
- @polymarket/builder-signing-sdk: ^0.0.8
- @polymarket/clob-client: ^5.1.2
- axios: ^1.13.2
- cors: ^2.8.5
- dotenv: ^17.2.3
- ethers: ^5.8.0
- express: ^4.22.1
- magic-sdk: ^32.0.0
- viem: ^2.43.3

## Security Practices
- Do not commit `.env` or secrets (covered by `.gitignore`).
- Keep Builder/Relayer credentials server-side only.
- Use rate limits and caching where appropriate.

## Run
To start the dashboard server:

```bash
node dashboard-server.js
```
