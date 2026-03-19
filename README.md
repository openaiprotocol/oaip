# OAIP PVM Verifier

Production-oriented cross-VM verification stack for Groth16 proofs, combining:

- Solidity contracts as the EVM entrypoint and registry
- Rust verifier execution in PVM-compatible targets
- A Rust CLI for proof/key conversion and frontend bridge generation
- A Next.js frontend for operator workflows

Repository: [openaiprotocol/oaip](https://github.com/openaiprotocol/oaip)

## Architecture

The system accepts proof submissions at the EVM layer and dispatches verification to a Rust verifier through cross-VM call boundaries.

- EVM entrypoint: `contracts/OIAP_Tracer_Caller.sol`
- Verification and nullifier registry: `contracts/VerificationRegistry.sol`
- Rust verifiers:
  - `contracts/pvm_verifier` (wasm build target)
  - `contracts/pvm_zk_verifier` (polkavm target)
- CLI tooling: `prover-cli`
- Frontend: `frontend`

Detailed flow is documented in `ARCHITECTURE.md`.

## Prerequisites

- Node.js 20+
- npm 10+
- Rust stable and nightly toolchains
- Rust target: `wasm32-unknown-unknown`
- Nightly component: `rust-src`

Suggested setup:

```bash
rustup toolchain install nightly
rustup component add rust-src --toolchain nightly
rustup target add wasm32-unknown-unknown
```

## Installation

```bash
git clone https://github.com/openaiprotocol/oaip.git
cd oaip
npm install
```

## Local Verification Commands

Run all essential checks:

```bash
npm run check:all
```

Or run by scope:

```bash
# EVM contracts and tests
npm run test:evm

# Frontend
npm run lint:frontend
npm run build:frontend

# Rust CLI
npm run build:prover-cli

# Rust verifiers
npm run build:pvm-verifier
npm run build:pvm-zk-verifier
```

## CLI Workflows

### 1) Mock generation (explicit only)

```bash
cd prover-cli
cargo run -- generate --mock --secret 0x123 --cooperative 42 --epoch 1740000000
```

### 2) Convert `verification_key.json` to `verification_key.bin`

```bash
cd prover-cli
cargo run -- vk-to-bin \
  --vk-json /path/to/verification_key.json \
  --check
```

Outputs:

- `contracts/pvm_verifier/keys/verification_key.bin`
- `contracts/pvm_zk_verifier/keys/verification_key.bin`

### 3) Convert snarkjs proof/public signals into frontend bridge JSON

```bash
cd prover-cli
cargo run -- proof-to-bridge \
  --proof-json /path/to/proof.json \
  --public-json /path/to/public.json \
  --vk-bin ../contracts/pvm_zk_verifier/keys/verification_key.bin \
  --write-frontend
```

This writes `frontend/public/verifier-inputs.json`, which can be loaded from the frontend using **Load Generated Inputs**.

## CI

GitHub Actions is configured to run:

- Hardhat tests
- Frontend lint + production build
- `prover-cli` build
- `pvm_verifier` wasm build
- `pvm_zk_verifier` nightly polkavm build

See `.github/workflows/ci.yml`.

## Operational Notes

- `VerificationRegistry` packs scalar public inputs in little-endian bytes32 form for deterministic Arkworks decoding compatibility.
- Frontend requires `NEXT_PUBLIC_REGISTRY_ADDRESS` to point to a deployed `VerificationRegistry`.
- For deployment pipeline details, see `scripts/deploy.sh`.
