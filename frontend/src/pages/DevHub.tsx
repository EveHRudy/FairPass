import { useState, useEffect } from 'react';
import { isAddress, parseEther } from 'ethers';
import { useWallet } from '../context/WalletContext';
import { useToast } from '../context/ToastContext';
import { useData } from '../context/DataContext';
import { useAsync } from '../hooks/useAsync';
import * as api from '../lib/api';
import { CONTRACT_ADDRESS } from '../lib/contract';
import { CHAIN_ID, EXPLORER_URL } from '../lib/config';
import { parseError, shortAddr } from '../lib/format';
import { Spinner, ErrorNote, PageHeader } from '../components/ui';

export default function DevHub() {
  const {
    address,
    signer,
    chainId,
    networkName,
    balance,
    connect,
    connecting,
    switchNetwork,
    refreshBalance,
  } = useWallet();

  const toast = useToast();
  const { refresh } = useData();

  // Test accounts from backend
  const {
    data: devData,
    loading: loadingAccounts,
    error: errorAccounts,
    reload: reloadAccounts,
  } = useAsync(async () => {
    try {
      return await api.getDevAccounts();
    } catch {
      return null;
    }
  }, []);

  // Chain status from backend
  const {
    data: chainStatus,
    loading: loadingChain,
    reload: reloadChain,
  } = useAsync(async () => {
    try {
      return await api.getChainStatus();
    } catch {
      return null;
    }
  }, []);

  // Transfer form state
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('1.0');
  const [txBusy, setTxBusy] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);
  const [showImportGuide, setShowImportGuide] = useState(false);

  // Auto-refresh when transaction confirms
  const handleReloadAll = () => {
    refreshBalance();
    reloadAccounts();
    reloadChain();
    refresh();
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedAddr(text);
    setTimeout(() => setCopiedAddr(null), 2000);
  };

  const handleQuickSend = (toAddr: string) => {
    setRecipient(toAddr);
    setTxError(null);
    setTxHash(null);
  };

  // Submit sample ETH transfer
  async function submitTransfer(e: React.FormEvent) {
    e.preventDefault();
    setTxError(null);
    setTxHash(null);

    if (!address || !signer) {
      return setTxError('Please connect your MetaMask wallet first.');
    }

    const trimmedRecipient = recipient.trim();
    if (!trimmedRecipient || !isAddress(trimmedRecipient)) {
      return setTxError('Please enter a valid recipient Ethereum address (0x...).');
    }

    if (trimmedRecipient.toLowerCase() === address.toLowerCase()) {
      return setTxError('Recipient cannot be your currently connected address.');
    }

    let parsedAmount: bigint;
    try {
      parsedAmount = parseEther(amount.trim());
      if (parsedAmount <= 0n) {
        return setTxError('Amount must be greater than 0 ETH.');
      }
    } catch {
      return setTxError('Invalid ETH amount format. Example: 0.5');
    }

    if (balance && Number(amount) >= Number(balance)) {
      return setTxError(`Insufficient funds. Your balance is ${Number(balance).toFixed(4)} ETH (remember to leave gas for fees).`);
    }

    setTxBusy(true);
    try {
      const tx = await signer.sendTransaction({
        to: trimmedRecipient,
        value: parsedAmount,
      });

      toast.push('info', 'Transaction submitted to blockchain. Awaiting confirmation…', tx.hash);
      const receipt = await tx.wait();

      setTxHash(receipt?.hash ?? tx.hash);
      toast.push('success', `Sent ${amount} ETH to ${shortAddr(trimmedRecipient)}!`, receipt?.hash ?? tx.hash);
      handleReloadAll();
    } catch (err) {
      setTxError(parseError(err));
    } finally {
      setTxBusy(false);
    }
  }

  const isLocalChain = chainId === 31337;
  const isSepolia = chainId === 11155111;

  return (
    <div className="grid gap-8">
      <PageHeader title="Development & Testnet Hub">
        Test blockchain accounts, verify local RPC connectivity, and execute sample transactions using MetaMask.
      </PageHeader>

      {/* Network & Local Blockchain Connectivity Status */}
      <section className="panel grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/10 pb-4">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <span
                className={`inline-block h-3 w-3 rounded-full ${
                  chainStatus?.connected ? 'bg-ok animate-pulse' : 'bg-bad'
                }`}
              />
              Blockchain Network Status
            </h2>
            <p className="text-sm text-mute mt-1">
              {chainStatus?.connected
                ? `Connected to ${chainStatus.networkName} (Chain ID: ${chainStatus.chainId})`
                : 'Blockchain RPC node is offline or unreachable.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => switchNetwork(31337)}
              className={`btn text-xs !px-3 !py-1.5 ${
                isLocalChain ? 'btn-primary' : 'btn-secondary'
              }`}
            >
              Switch to Hardhat (31337)
            </button>
            <button
              onClick={() => switchNetwork(11155111)}
              className={`btn text-xs !px-3 !py-1.5 ${
                isSepolia ? 'btn-primary' : 'btn-secondary'
              }`}
            >
              Switch to Sepolia (11155111)
            </button>
            <button onClick={handleReloadAll} className="btn btn-ghost text-xs !px-2.5">
              ↻ Refresh
            </button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl bg-ink/5 p-3">
            <p className="text-xs text-mute uppercase font-semibold">Current Network</p>
            <p className="text-base font-bold mt-0.5">{networkName ?? (chainId ? `Chain ${chainId}` : 'Not connected')}</p>
          </div>
          <div className="rounded-xl bg-ink/5 p-3">
            <p className="text-xs text-mute uppercase font-semibold">Latest Block</p>
            <p className="text-base font-bold mt-0.5 font-mono">
              {chainStatus?.blockNumber !== null && chainStatus?.blockNumber !== undefined
                ? `#${chainStatus.blockNumber}`
                : '—'}
            </p>
          </div>
          <div className="rounded-xl bg-ink/5 p-3 sm:col-span-2">
            <p className="text-xs text-mute uppercase font-semibold">Deployed TicketNFT Contract</p>
            <p className="text-sm font-mono font-bold mt-0.5 break-all">
              {chainStatus?.contractAddress || CONTRACT_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3'}
            </p>
          </div>
        </div>

        {chainStatus?.instructions && (
          <div className="rounded-xl bg-bad-soft p-4 text-sm text-bad border border-bad/20">
            <p className="font-semibold">Local Node Offline:</p>
            <p className="mt-1">{chainStatus.instructions}</p>
          </div>
        )}
      </section>

      {/* Test Accounts & Balance Display */}
      <section className="panel grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/10 pb-4">
          <div>
            <h2 className="text-xl font-bold">Funded Test Blockchain Accounts</h2>
            <p className="text-sm text-mute mt-1">
              Standard local Hardhat development accounts pre-funded with test ETH. Private keys are never exposed over the network.
            </p>
          </div>
          <button
            onClick={() => setShowImportGuide(!showImportGuide)}
            className="btn btn-secondary text-sm !px-3"
          >
            {showImportGuide ? 'Hide Import Guide' : 'Import to MetaMask Guide ↗'}
          </button>
        </div>

        {/* Import instructions collapsible banner */}
        {showImportGuide && (
          <div className="rounded-xl border border-brand/20 bg-brand-soft/40 p-4 text-sm leading-relaxed">
            <h3 className="font-bold text-brand-dark flex items-center gap-2">
              <span>🔑</span> How to Import Test Accounts into MetaMask (Local Development)
            </h3>
            <ol className="mt-2 list-decimal list-inside space-y-1.5 text-mute">
              <li>
                In your terminal, run <code className="font-mono text-ink font-semibold">npm run dev:accounts</code> to safely output the local test private keys in your private terminal console.
              </li>
              <li>Open your MetaMask browser extension and switch to <strong>Hardhat Localhost</strong> (RPC: <code className="font-mono">http://127.0.0.1:8545</code>, Chain ID: <code className="font-mono">31337</code>).</li>
              <li>Click the Account dropdown at the top center of MetaMask.</li>
              <li>Click <strong>&quot;Add account or hardware wallet&quot;</strong> &rarr; <strong>&quot;Import account&quot;</strong>.</li>
              <li>Paste the private key for the account you wish to test (e.g. Account #0 for Organizer, Account #1 for Buyer) and click <strong>Import</strong>.</li>
              <li>The account will immediately appear with a 10,000 ETH test balance ready for transactions!</li>
            </ol>
            <p className="mt-2 text-xs text-mute italic">
              * Security Note: These keys are for local development testing only and hold zero real value.
            </p>
          </div>
        )}

        {loadingAccounts && !devData ? (
          <Spinner label="Loading test account balances…" />
        ) : errorAccounts ? (
          <ErrorNote message={errorAccounts} onRetry={reloadAccounts} />
        ) : (
          <div className="grid gap-3">
            {devData?.accounts.map((acc) => {
              const isCurrent = address?.toLowerCase() === acc.address.toLowerCase();
              return (
                <div
                  key={acc.address}
                  className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4 transition-colors ${
                    isCurrent
                      ? 'border-brand bg-brand-soft/20 shadow-sm'
                      : 'border-ink/10 bg-white hover:border-ink/20'
                  }`}
                >
                  <div className="grid gap-1 min-w-[280px]">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-ink">{acc.label}</span>
                      {isCurrent && (
                        <span className="rounded-full bg-ok-soft px-2 py-0.5 text-xs font-semibold text-ok">
                          Connected in MetaMask
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-xs text-mute break-all">{acc.address}</code>
                      <button
                        onClick={() => handleCopy(acc.address)}
                        className="text-xs text-brand hover:underline font-medium"
                        title="Copy address"
                      >
                        {copiedAddr === acc.address ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <p className="text-xs text-mute">{acc.description}</p>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-xs text-mute font-medium">Balance</p>
                      <p className="text-base font-bold font-mono text-ink">
                        {Number(acc.balanceEth).toLocaleString(undefined, { maximumFractionDigits: 4 })} ETH
                      </p>
                    </div>

                    {!isCurrent && (
                      <button
                        onClick={() => handleQuickSend(acc.address)}
                        className="btn btn-secondary text-xs !px-3 !py-1.5"
                      >
                        Send ETH &rarr;
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Sample Transaction Workflow: Transfer Test ETH */}
      <section className="panel grid gap-6">
        <div>
          <h2 className="text-xl font-bold">Sample Transaction: Send Test ETH</h2>
          <p className="text-sm text-mute mt-1">
            Execute a real blockchain transaction through MetaMask between development accounts.
          </p>
        </div>

        {!address ? (
          <div className="rounded-xl border border-dashed border-ink/20 p-6 text-center">
            <p className="text-mute text-sm mb-4">Connect MetaMask to test sending ETH transactions.</p>
            <button className="btn btn-primary" onClick={connect} disabled={connecting}>
              {connecting ? 'Connecting…' : 'Connect Wallet'}
            </button>
          </div>
        ) : (
          <form onSubmit={submitTransfer} className="grid gap-4 max-w-xl">
            <div className="rounded-xl bg-ink/5 p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-mute font-semibold uppercase">Sender (Connected Wallet)</p>
                <p className="font-mono text-sm font-bold mt-0.5">{shortAddr(address)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-mute font-semibold uppercase">Available Balance</p>
                <p className="font-mono text-sm font-bold text-ok mt-0.5">
                  {balance ? `${Number(balance).toFixed(4)} ETH` : 'Loading…'}
                </p>
              </div>
            </div>

            <div>
              <label className="label" htmlFor="recipient-input">
                Recipient Address
              </label>
              <input
                id="recipient-input"
                className="input font-mono text-sm"
                placeholder="0x..."
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                disabled={txBusy}
                required
              />
              <p className="mt-1 text-xs text-mute">
                Quick pick test account:
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {devData?.accounts
                  .filter((a) => a.address.toLowerCase() !== address.toLowerCase())
                  .map((a) => (
                    <button
                      key={a.address}
                      type="button"
                      onClick={() => handleQuickSend(a.address)}
                      className="rounded bg-ink/5 px-2 py-1 text-xs font-mono text-ink hover:bg-ink/10 transition-colors"
                    >
                      {a.label.split('—')[0].trim()} ({shortAddr(a.address)})
                    </button>
                  ))}
              </div>
            </div>

            <div>
              <label className="label" htmlFor="amount-input">
                Amount to Send (ETH)
              </label>
              <div className="flex gap-2">
                <input
                  id="amount-input"
                  type="number"
                  step="0.001"
                  min="0.0001"
                  className="input font-mono text-sm flex-1"
                  placeholder="1.0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={txBusy}
                  required
                />
                <button
                  type="button"
                  onClick={() => setAmount('0.1')}
                  className="btn btn-secondary text-xs !px-3"
                >
                  0.1 ETH
                </button>
                <button
                  type="button"
                  onClick={() => setAmount('1')}
                  className="btn btn-secondary text-xs !px-3"
                >
                  1 ETH
                </button>
                <button
                  type="button"
                  onClick={() => setAmount('5')}
                  className="btn btn-secondary text-xs !px-3"
                >
                  5 ETH
                </button>
              </div>
            </div>

            {txError && (
              <p className="rounded-lg bg-bad-soft p-3 text-sm text-bad" role="alert">
                {txError}
              </p>
            )}

            {txHash && (
              <div className="rounded-lg bg-ok-soft p-3 text-sm text-ok">
                <p className="font-semibold">Transaction Confirmed!</p>
                <p className="font-mono text-xs mt-1 break-all">Hash: {txHash}</p>
                {isSepolia && (
                  <a
                    href={`${EXPLORER_URL}/tx/${txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-xs font-semibold underline"
                  >
                    View on Sepolia Etherscan &rarr;
                  </a>
                )}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={txBusy || !recipient || !amount}
            >
              {txBusy ? 'Confirm in MetaMask…' : 'Send Transaction via MetaMask'}
            </button>
          </form>
        )}
      </section>

      {/* Smart Contract Interaction Flow */}
      <section className="panel grid gap-4">
        <div>
          <h2 className="text-xl font-bold">Smart Contract Live Verification</h2>
          <p className="text-sm text-mute mt-1">
            Test the full FairPass smart contract ecosystem with your connected test account.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-ink/10 p-4 bg-white flex flex-col justify-between">
            <div>
              <span className="text-2xl">🎟️</span>
              <h3 className="font-bold text-base mt-2">1. Primary Ticket Purchase</h3>
              <p className="text-xs text-mute mt-1">
                Mint a new ticket NFT on-chain with IPFS metadata URI and organizer royalty binding.
              </p>
            </div>
            <a href="/" className="btn btn-primary text-xs mt-4 text-center">
              Browse & Buy Tickets &rarr;
            </a>
          </div>

          <div className="rounded-xl border border-ink/10 p-4 bg-white flex flex-col justify-between">
            <div>
              <span className="text-2xl">📈</span>
              <h3 className="font-bold text-base mt-2">2. Capped Resale Marketplace</h3>
              <p className="text-xs text-mute mt-1">
                List or buy resale tickets under strict on-chain price caps (face value + cap %) and organizer royalties.
              </p>
            </div>
            <a href="/marketplace" className="btn btn-primary text-xs mt-4 text-center">
              Open Marketplace &rarr;
            </a>
          </div>

          <div className="rounded-xl border border-ink/10 p-4 bg-white flex flex-col justify-between">
            <div>
              <span className="text-2xl">📱</span>
              <h3 className="font-bold text-base mt-2">3. Venue Gate Scanner</h3>
              <p className="text-xs text-mute mt-1">
                Scan attendee entry QR codes and record on-chain check-in using an authorized venue scanner address.
              </p>
            </div>
            <a href="/venue/scan" className="btn btn-primary text-xs mt-4 text-center">
              Launch Scanner &rarr;
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
