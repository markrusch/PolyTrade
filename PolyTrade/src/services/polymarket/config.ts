import dotenv from 'dotenv';
import { JsonRpcProvider } from 'ethers';

dotenv.config();

export type ApiCreds = {
  key: string;
  secret: string;
  passphrase: string;
};

export const config = {
  chainId: Number(process.env.CHAIN_ID || 137),
  clobHost: process.env.CLOB_HOST || 'https://clob.polymarket.com',
  privateKey:
    process.env.POLYMARKETS_PRIVATE_KEY || process.env.PRIVATE_KEY || '',
  funderAddress:
    process.env.POLYMARKET_FUNDER_ADDRESS || process.env.FUNDER_ADDRESS || '',
  signatureType: Number(process.env.SIGNATURE_TYPE || 2),
  rpcUrl: process.env.RPC_LINK_INFURA,
  apiCreds: (() => {
    const key =
      process.env.CLOB_API_KEY ||
      process.env.POLYMARKET_API_KEY ||
      process.env.POLY_BUILDER_API_KEY;
    const secret =
      process.env.CLOB_SECRET ||
      process.env.POLYMARKET_SECRET ||
      process.env.POLY_BUILDER_SECRET;
    const passphrase =
      process.env.CLOB_PASSPHRASE ||
      process.env.POLYMARKET_PASSPHRASE ||
      process.env.POLY_BUILDER_PASSPHRASE;
    return key && secret && passphrase ? { key, secret, passphrase } : null;
  })(),
};

export function getProvider(): JsonRpcProvider | undefined {
  if (!config.rpcUrl) return undefined;
  return new JsonRpcProvider(config.rpcUrl, config.chainId);
}
