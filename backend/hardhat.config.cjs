// Only used by `npm run test:chain` to start a local JSON-RPC node. Contracts live in the contracts repo.
module.exports = { solidity: '0.8.24', networks: { hardhat: { chainId: 31337 } } };
