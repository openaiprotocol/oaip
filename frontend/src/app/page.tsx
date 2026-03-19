"use client";

import { useState } from 'react';
import { ethers } from 'ethers';
import type { Eip1193Provider } from 'ethers';

// Demo ABI and mock Address for Phase 1 Sprint
const VERIFIER_ABI = [
  "function verifyAndRecord(bytes calldata proofBytes, bytes32 nullifier, bytes32 cooperativeHash, uint256 validUntil, uint256 currentTime) external returns (bool)"
];
const MOCK_REGISTRY_ADDRESS = "0x0000000000000000000000000000000000000000";
const REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? MOCK_REGISTRY_ADDRESS;

type BridgeInputs = {
  proofBytes: string;
  nullifier: string;
  cooperativeHash: string;
  validUntil: string;
  currentTime: string;
};

export default function Home() {
  const [proof, setProof] = useState('');
  const [nullifier, setNullifier] = useState('');
  const [coopHash, setCoopHash] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [currentTime, setCurrentTime] = useState('');
  const [status, setStatus] = useState('');
  const [statusKind, setStatusKind] = useState<'success' | 'error' | 'info'>('info');
  const [isVerifying, setIsVerifying] = useState(false);

  const isHexBytes = (value: string, expectedBytes: number): boolean => {
    if (!value.startsWith('0x')) return false;
    if (!/^0x[0-9a-fA-F]+$/.test(value)) return false;
    return value.length === 2 + expectedBytes * 2;
  };

  const loadGeneratedInputs = async () => {
    try {
      setStatusKind('info');
      setStatus('Loading /verifier-inputs.json...');
      const res = await fetch('/verifier-inputs.json', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`failed to fetch bridge file (${res.status})`);
      }
      const json = (await res.json()) as BridgeInputs;
      if (
        !json.proofBytes ||
        !json.nullifier ||
        !json.cooperativeHash ||
        json.validUntil === undefined ||
        json.currentTime === undefined
      ) {
        throw new Error('bridge file is missing required fields');
      }

      setProof(json.proofBytes);
      setNullifier(json.nullifier);
      setCoopHash(json.cooperativeHash);
      setValidUntil(String(json.validUntil));
      setCurrentTime(String(json.currentTime));
      setStatusKind('success');
      setStatus('Loaded generated inputs from /verifier-inputs.json');
    } catch (error) {
      console.error(error);
      const msg =
        error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';
      setStatusKind('error');
      setStatus(`Failed to load generated inputs: ${msg}`);
    }
  };

  const fillCurrentTimeNow = () => {
    setCurrentTime(String(Math.floor(Date.now() / 1000)));
  };

  const handleVerify = async () => {
    setIsVerifying(true);
    setStatusKind('info');
    setStatus('Connecting wallet...');

    try {
      const ethereum = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
      if (!ethereum) {
        throw new Error('No injected wallet provider found (window.ethereum)');
      }
      if (!ethers.isAddress(REGISTRY_ADDRESS) || REGISTRY_ADDRESS === ethers.ZeroAddress) {
        throw new Error('Missing NEXT_PUBLIC_REGISTRY_ADDRESS');
      }

      if (!proof || !nullifier || !coopHash || !validUntil || !currentTime) {
        throw new Error('Missing required fields');
      }

      // Minimal format checks so we fail fast client-side.
      if (!isHexBytes(proof, 256)) {
        throw new Error('proof must be 256 bytes hex (0x + 512 hex chars)');
      }
      if (!isHexBytes(nullifier, 32)) {
        throw new Error('nullifier must be bytes32 hex (0x + 64 hex chars)');
      }
      if (!isHexBytes(coopHash, 32)) {
        throw new Error('cooperativeHash must be bytes32 hex (0x + 64 hex chars)');
      }

      let validUntilBn: bigint;
      try {
        validUntilBn = BigInt(validUntil);
      } catch {
        throw new Error('validUntil must be a valid unix timestamp number');
      }
      let currentTimeBn: bigint;
      try {
        currentTimeBn = BigInt(currentTime);
      } catch {
        throw new Error('currentTime must be a valid unix timestamp number');
      }

      const provider = new ethers.BrowserProvider(ethereum);
      const signer = await provider.getSigner();
      const registry = new ethers.Contract(REGISTRY_ADDRESS, VERIFIER_ABI, signer);

      setStatus('Calling verifyAndRecord (static)...');
      const isValid: boolean = await registry.verifyAndRecord.staticCall(
        proof,
        nullifier,
        coopHash,
        validUntilBn,
        currentTimeBn
      );

      if (!isValid) {
        setStatusKind('error');
        setStatus('Verification failed: proof is not valid (PVM returned false).');
        return;
      }

      setStatusKind('info');
      setStatus('Proof is valid. Sending transaction to record...');
      const tx = await registry.verifyAndRecord(proof, nullifier, coopHash, validUntilBn, currentTimeBn);
      await tx.wait();
      setStatusKind('success');
      setStatus('Verification successful: proof was recorded.');
      
    } catch (error) {
      console.error(error);
      const msg =
        error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';
      setStatusKind('error');
      setStatus(`Verification error: ${msg}`);
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24 bg-gray-950 text-white">
      <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm">
        <h1 className="text-4xl font-bold mb-8 text-center text-pink-500">
          OIAP PVM-Native ZK Verifier
        </h1>
        <p className="text-center mb-12 text-gray-400">
          Validating Cooperative Membership zero-knowledge proofs on Polkadot Hub using cross-VM calls to Rust ink!
        </p>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 max-w-2xl mx-auto shadow-2xl">
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Proof Bytes (ABI-Encoded G1/G2/G1)
              </label>
              <textarea 
                className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 h-32 font-mono text-xs focus:ring-2 focus:ring-pink-500 focus:outline-none"
                placeholder="0x..."
                value={proof}
                onChange={(e) => setProof(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Nullifier (bytes32)
              </label>
              <input 
                type="text"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 font-mono text-xs focus:ring-2 focus:ring-pink-500 focus:outline-none"
                placeholder="0x..."
                value={nullifier}
                onChange={(e) => setNullifier(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Cooperative Hash (bytes32)
              </label>
              <input 
                type="text"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 font-mono text-xs focus:ring-2 focus:ring-pink-500 focus:outline-none"
                placeholder="0x..."
                value={coopHash}
                onChange={(e) => setCoopHash(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Valid Until (unix timestamp, seconds)
              </label>
              <input
                type="text"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 font-mono text-xs focus:ring-2 focus:ring-pink-500 focus:outline-none"
                placeholder="e.g. 1740000000"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Current Time (unix timestamp, seconds)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 font-mono text-xs focus:ring-2 focus:ring-pink-500 focus:outline-none"
                  placeholder="e.g. 1740000000"
                  value={currentTime}
                  onChange={(e) => setCurrentTime(e.target.value)}
                />
                <button
                  type="button"
                  onClick={fillCurrentTimeNow}
                  className="px-3 py-2 rounded-lg text-xs bg-gray-800 border border-gray-700 hover:bg-gray-700 transition-colors"
                >
                  Now
                </button>
              </div>
            </div>

            <button
              onClick={loadGeneratedInputs}
              disabled={isVerifying}
              className="w-full py-3 rounded-lg font-semibold text-sm bg-gray-800 border border-gray-700 hover:bg-gray-700 transition-colors"
            >
              Load Generated Inputs
            </button>

            <button
              onClick={handleVerify}
              disabled={isVerifying}
              className={`w-full py-4 rounded-lg font-bold text-lg transition-all ${
                isVerifying 
                  ? 'bg-gray-700 text-gray-400 cursor-not-allowed' 
                  : 'bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 shadow-lg shadow-pink-500/30'
              }`}
            >
              {isVerifying ? 'Verifying...' : 'Verify Membership'}
            </button>

            {status && (
              <div className={`p-4 rounded-lg mt-6 ${statusKind === 'success' ? 'bg-green-900/50 border border-green-800 text-green-400' : statusKind === 'error' ? 'bg-red-900/50 border border-red-800 text-red-400' : 'bg-blue-900/50 border border-blue-800 text-blue-400'}`}>
                <p className="font-mono text-sm">{status}</p>
              </div>
            )}
            
          </div>
        </div>

        <div className="mt-16 bg-gray-900 border border-gray-800 p-6 rounded-lg text-xs font-mono text-gray-500">
          <p>Phase 1 Tracer Sprint: Demoing EVM to Wasm cross-compilation pipeline.</p>
          <p>Target Network: Polkadot Hub Testnet (Westend Asset Hub)</p>
          <p>PVM Framework: ink! 5.x</p>
        </div>
      </div>
    </main>
  );
}
