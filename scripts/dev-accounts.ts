import { ethers } from 'ethers';

// Standard well-known Hardhat development mnemonic
const HARDHAT_MNEMONIC = 'test test test test test test test test test test test junk';
const LOCAL_RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';

const ROLES = [
  'Account #0 — Deployer & Event Organizer',
  'Account #1 — Primary Buyer (Alice)',
  'Account #2 — Secondary Buyer (Bob)',
  'Account #3 — Ticket Reseller (Charlie)',
  'Account #4 — Venue Door Scanner (Door Staff)',
];

async function main() {
  console.log('\n========================================================================');
  console.log('       FAIRPASS LOCAL DEVELOPMENT TEST ACCOUNTS (METAMASK PROVISIONING)       ');
  console.log('========================================================================\n');
  console.log('SECURITY WARNING:');
  console.log('  * These accounts and private keys are public test credentials.');
  console.log('  * USE ONLY on local Hardhat testnet (Chain ID 31337).');
  console.log('  * NEVER send real mainnet funds to any of these addresses.\n');

  let provider: ethers.JsonRpcProvider | null = null;
  let isNodeOnline = false;
  try {
    provider = new ethers.JsonRpcProvider(LOCAL_RPC_URL, undefined, { staticNetwork: true });
    await provider.getBlockNumber();
    isNodeOnline = true;
    console.log(`[+] Connected to local blockchain at ${LOCAL_RPC_URL}`);
  } catch {
    console.log(`[!] Local node at ${LOCAL_RPC_URL} is not responding.`);
    console.log(`    Run 'npx hardhat node' in a separate terminal to start it.\n`);
  }

  console.log('------------------------------------------------------------------------');
  for (let i = 0; i < ROLES.length; i++) {
    const path = `m/44'/60'/0'/0/${i}`;
    const wallet = ethers.HDNodeWallet.fromPhrase(HARDHAT_MNEMONIC, '', path);

    let balanceStr = '10,000.0 ETH (estimated)';
    if (isNodeOnline && provider) {
      try {
        const bal = await provider.getBalance(wallet.address);
        balanceStr = `${ethers.formatEther(bal)} ETH`;
      } catch {
        // use default estimate
      }
    }

    console.log(`[${i}] ${ROLES[i]}`);
    console.log(`    Address:     ${wallet.address}`);
    console.log(`    Balance:     ${balanceStr}`);
    console.log(`    Private Key: ${wallet.privateKey}`);
    console.log('------------------------------------------------------------------------');
  }

  console.log('\nHOW TO IMPORT AN ACCOUNT INTO METAMASK:');
  console.log('  1. Open the MetaMask browser extension.');
  console.log('  2. In the network dropdown at top-left, select "Hardhat Localhost"');
  console.log('     (RPC: http://127.0.0.1:8545, Chain ID: 31337, Currency: ETH).');
  console.log('  3. Click on the Account selector (top center of MetaMask).');
  console.log('  4. Select "Add account or hardware wallet" -> "Import account".');
  console.log('  5. Paste one of the Private Keys above and click "Import".');
  console.log('  6. Your imported test account will immediately show a 10,000 ETH test balance.\n');
}

main().catch(console.error);
