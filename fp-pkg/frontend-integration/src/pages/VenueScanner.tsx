/**
 * Venue scanner page (Person 5). Route suggestion: /venue/scan  (does not touch Person 4's pages).
 * Needs:  npm i html5-qrcode ethers
 * Props come from Person 4's config (VITE_API_URL, VITE_CONTRACT_ADDRESS, VITE_CHAIN_ID) and the real contract ABI.
 */
import { Html5Qrcode } from 'html5-qrcode';
import { BrowserProvider, Contract, type JsonRpcSigner } from 'ethers';
import { useCallback, useEffect, useRef, useState } from 'react';
import { decodeQrPayload, FairPassApiError, getTicketStatus, verifyQr, type VerifyResponse } from '../lib/fairpassCheckin';

type Phase =
  | { k: 'ready' } | { k: 'verifying' } | { k: 'valid'; ticketId: string; owner: string }
  | { k: 'tx-pending'; ticketId: string; hash?: string } | { k: 'checked-in'; ticketId: string; hash: string }
  | { k: 'invalid'; title: string; detail: string } | { k: 'tx-failed'; ticketId: string; detail: string };

const CHECKIN_ABI = ['function checkIn(uint256 ticketId)']; // function name per the project spec; pass the full ABI via props to override

const TITLES: Record<string, string> = {
  EXPIRED: 'Expired QR', ALREADY_CONSUMED: 'QR already used', ALREADY_USED: 'Already used', NOT_OWNER: 'Invalid ticket',
  BAD_SIGNATURE: 'Invalid ticket', UNKNOWN_CHALLENGE: 'Invalid ticket', TICKET_MISMATCH: 'Invalid ticket', TICKET_NOT_FOUND: 'Invalid ticket',
};

export interface VenueScannerProps {
  apiBase: string;
  contractAddress: string;
  chainId: number;
  /** Full contract ABI from Person 1/2 artifacts (optional; defaults to the single checkIn function). */
  abi?: ConstructorParameters<typeof Contract>[1];
}

export default function VenueScanner({ apiBase, contractAddress, chainId, abi = CHECKIN_ABI }: VenueScannerProps) {
  const [account, setAccount] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ k: 'ready' });
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const signerRef = useRef<JsonRpcSigner | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const busy = useRef(false);               // blocks duplicate submissions while a scan / tx is in flight

  const connect = async () => {
    const eth = (window as any).ethereum;
    if (!eth) { setPhase({ k: 'invalid', title: 'No wallet', detail: 'Install MetaMask to use the scanner.' }); return; }
    const provider = new BrowserProvider(eth);
    await provider.send('eth_requestAccounts', []);
    const net = await provider.getNetwork();
    if (Number(net.chainId) !== chainId) {
      try { await provider.send('wallet_switchEthereumChain', [{ chainId: '0x' + chainId.toString(16) }]); }
      catch { setPhase({ k: 'invalid', title: 'Wrong network', detail: `Switch MetaMask to chain ${chainId}.` }); return; }
    }
    signerRef.current = await new BrowserProvider(eth).getSigner();
    setAccount(await signerRef.current.getAddress());
    setPhase({ k: 'ready' });
  };

  const handleScan = useCallback(async (text: string) => {
    if (busy.current) return;
    busy.current = true;
    setPhase({ k: 'verifying' });
    try {
      const payload = decodeQrPayload(text);
      const r: VerifyResponse = await verifyQr(apiBase, payload);
      if (r.valid && r.ticketId) setPhase({ k: 'valid', ticketId: r.ticketId, owner: r.owner ?? '' });
      else { setPhase({ k: 'invalid', title: TITLES[r.code] ?? 'Invalid ticket', detail: r.message }); busy.current = false; }
    } catch (e) {
      const detail = e instanceof FairPassApiError && e.status === 503 ? 'Server cannot reach the blockchain. Scan again in a moment.' : (e as Error).message;
      setPhase({ k: 'invalid', title: e instanceof FairPassApiError ? 'Verification error' : 'Unreadable QR', detail });
      busy.current = false;
    }
  }, [apiBase]);

  // The backend consumed the QR when it said "valid". The on-chain transaction is what actually checks the ticket in.
  const submitCheckIn = async (ticketId: string) => {
    const signer = signerRef.current;
    if (!signer) return;
    setPhase({ k: 'tx-pending', ticketId });
    try {
      const contract = new Contract(contractAddress, abi, signer);
      const tx = await contract.getFunction('checkIn')(BigInt(ticketId));
      setPhase({ k: 'tx-pending', ticketId, hash: tx.hash });
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) throw new Error('Transaction reverted.');
      const status = await getTicketStatus(apiBase, ticketId);          // double-check against the chain
      if (!status.checkedIn) throw new Error('Transaction mined but the contract does not report the ticket as checked in.');
      setPhase({ k: 'checked-in', ticketId, hash: receipt.hash });
    } catch (e: any) {
      const detail = e?.code === 'ACTION_REJECTED' ? 'Transaction rejected in the wallet. Ask the attendee to refresh their QR.'
        : e?.reason ?? e?.shortMessage ?? e?.message ?? 'Transaction failed.';
      setPhase({ k: 'tx-failed', ticketId, detail: `${detail} (This QR is used up - the attendee must show a fresh one.)` });
    } finally { busy.current = false; }
  };

  const reset = () => { busy.current = false; setPhase({ k: 'ready' }); };

  // camera
  useEffect(() => {
    if (!account) return;
    const scanner = new Html5Qrcode('fp-scanner-region');
    scannerRef.current = scanner;
    scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 260, height: 260 } }, (t) => { void handleScan(t); }, () => {})
      .catch((e: unknown) => setCameraError(/denied|permission/i.test(String(e)) ? 'Camera permission denied. Allow camera access, or paste the QR text below.'
        : 'No usable camera found. Paste the QR text below instead.'));
    return () => { scanner.isScanning ? scanner.stop().catch(() => {}) : undefined; scanner.clear(); };
  }, [account, handleScan]);

  const card = (bg: string, title: string, detail?: string, extra?: React.ReactNode) => (
    <div style={{ background: bg, color: '#fff', padding: 16, borderRadius: 12, marginTop: 16 }}>
      <h2 style={{ margin: 0 }}>{title}</h2>{detail && <p style={{ margin: '8px 0 0', wordBreak: 'break-word' }}>{detail}</p>}{extra}
    </div>
  );
  const again = <button onClick={reset} style={{ marginTop: 12 }}>Scan next ticket</button>;

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Venue Scanner</h1>
      {!account ? (
        <button onClick={connect}>Connect venue wallet</button>
      ) : (
        <p style={{ fontSize: 13 }}>Operator wallet: <code>{account.slice(0, 6)}…{account.slice(-4)}</code></p>
      )}
      <div id="fp-scanner-region" style={{ width: '100%', display: account && !cameraError ? 'block' : 'none' }} />
      {cameraError && <p role="alert">{cameraError}</p>}
      {account && (cameraError || true) && (
        <details open={!!cameraError}><summary>Paste QR text</summary>
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="FP1:…" style={{ width: '100%' }} />
          <button disabled={!manual || busy.current} onClick={() => void handleScan(manual.trim())}>Verify</button>
        </details>
      )}
      {account && phase.k === 'ready' && card('#475569', 'Ready to scan', 'Point the camera at the attendee’s QR code.')}
      {phase.k === 'verifying' && card('#2563eb', 'Verifying…')}
      {phase.k === 'valid' && card('#16a34a', 'Valid ticket', `Ticket #${phase.ticketId} verified. Confirm to record the check-in on-chain.`,
        <button onClick={() => void submitCheckIn(phase.ticketId)} style={{ marginTop: 12 }}>Confirm check-in (sign transaction)</button>)}
      {phase.k === 'tx-pending' && card('#d97706', 'Transaction pending', phase.hash ? `Waiting for confirmation: ${phase.hash}` : 'Approve the transaction in your wallet…')}
      {phase.k === 'checked-in' && card('#15803d', `Ticket #${phase.ticketId} checked in ✓`, `Confirmed on-chain: ${phase.hash}`, again)}
      {phase.k === 'invalid' && card('#dc2626', phase.title, phase.detail, again)}
      {phase.k === 'tx-failed' && card('#dc2626', 'Check-in failed', phase.detail, again)}
    </div>
  );
}
