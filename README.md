# PVM-Native ZK Identity Verifier

Built for the **Polkadot Solidity Hackathon 2026**.

## Overview

This project implements a high-performance, cost-effective ZK proof verification system on Polkadot Hub. It leverages the **Polkadot Virtual Machine (PVM)** to execute native Rust cryptography (`arkworks`) at near-hardware speeds, making it significantly cheaper than verifying proofs directly in the EVM.

A Solidity smart contract on the EVM side acts as the entry point, performing a **cross-VM call** to a Rust ink! contract running in the PVM.

## Project Structure

- `/contracts/pvm_verifier`: Rust ink! contract for Groth16 verification.
- `/contracts`: Solidity contracts (`OIAP_Tracer_Caller.sol`, `VerificationRegistry.sol`).
- `/prover-cli`: Rust binary to generate mock/real ZK proofs.
- `/frontend`: Next.js application for the verifier interface.
- `/test`: Hardhat tests for the EVM side.

## Key Features

- **PVM Acceleration**: Shifts heavy pairing math from EVM gas-metered execution to PVM native execution.
- **Cross-VM Interoperability**: Demonstrates Polkadot Hub's unique ability to bridge EVM and PVM contexts.
- **Zero-Knowledge Identity**: Foundational layer for the Open Identity & Attestation Protocol (OIAP).

## Getting Started

### Prerequisites

- Rust (with `wasm32-unknown-unknown` target)
- Node.js & npm
- Hardhat
- (Optional) `cargo-contract` for ink! deployment

### Installation

```bash
# Clone the repository
git clone https://github.com/provd/oiap
cd oiap

# Install EVM dependencies
npm install

# Build the ink! contract
cd contracts/pvm_verifier
cargo build --target wasm32-unknown-unknown --no-default-features --features ink-as-dependency
```

### Running Tests

```bash
# Run EVM side tests
npx hardhat test

# Run explicit mock prover output
cd prover-cli
cargo run -- generate --mock --secret 0x123 --cooperative 42 --epoch 1740000000
```

### Generate Real `verification_key.bin`

`prover-cli` can convert a snarkjs verification key JSON into the binary format
embedded by both Rust verifiers (`include_bytes!`):

```bash
cd prover-cli
cargo run -- vk-to-bin \
  --vk-json /path/to/verification_key.json \
  --check
```

By default this writes to:

- `contracts/pvm_verifier/keys/verification_key.bin`
- `contracts/pvm_zk_verifier/keys/verification_key.bin`

### Build Frontend Bridge Inputs From snarkjs

Convert snarkjs `proof.json` + `public.json` into the exact frontend fields
expected by `VerificationRegistry.verifyAndRecord(...)`:

```bash
cd prover-cli
cargo run -- proof-to-bridge \
  --proof-json /path/to/proof.json \
  --public-json /path/to/public.json \
  --vk-bin ../contracts/pvm_zk_verifier/keys/verification_key.bin \
  --write-frontend
```

This emits JSON to stdout and writes `frontend/public/verifier-inputs.json` when
`--write-frontend` is set. The frontend has a `Load Generated Inputs` button
that fetches this file and pre-fills the form.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for a detailed breakdown of the cross-VM data flow.

## Gas Benchmarks

Initial estimates show a **95% reduction** in gas costs compared to EVM-native Groth16 verification. See [BENCHMARKS.md](./BENCHMARKS.md) for details.
