import { defineChain } from 'viem';

/** Aevum Testnet (QDay) — chain 44005. */
export const aevumTestnet = defineChain({
  id: 44005,
  name: 'Aevum Testnet',
  nativeCurrency: { name: 'tQDAY', symbol: 'tQDAY', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc-test.qday.info'] },
    public: { http: ['https://rpc-test.qday.info'] },
  },
  blockExplorers: {
    default: { name: 'Aevum Explorer', url: 'https://explorer-test.qday.info' },
  },
  testnet: true,
});

/** Params for wallet_addEthereumChain (the "Add network" helper). */
export const AEVUM_CHAIN_PARAMS = {
  chainId: '0xABF5', // 44005
  chainName: 'Aevum Testnet',
  nativeCurrency: { name: 'tQDAY', symbol: 'tQDAY', decimals: 18 },
  rpcUrls: ['https://rpc-test.qday.info'],
  blockExplorerUrls: ['https://explorer-test.qday.info'],
} as const;
