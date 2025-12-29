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
Managed via `package.json`:
- `axios`: HTTP client for Core Data API
- `ethers`: Wallet and contract utils
- `@polymarket/clob-client`: CLOB client utilities

## Security Practices
- Do not commit `.env` or secrets (covered by `.gitignore`).
- Keep Builder/Relayer credentials server-side only.
- Use rate limits and caching where appropriate.
