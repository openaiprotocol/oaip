# OIAP PVM Verifier

Production-grade cross-VM Groth16 proof verification stack running on **Polkadot Hub**. It bridges the EVM execution model (Solidity) with native Rust Polkavm execution (`pallet-revive`), enabling cryptographic pairing operations to run in a verified, language-native environment while exposing a standard Solidity interface.

---

## What Is This?

The OIAP PVM Verifier lets any EVM-compatible dApp on Polkadot Hub verify a Groth16 zero-knowledge proof with a single contract call, without implementing any ZK cryptography in Solidity. The heavy lifting — elliptic curve pairing over BN254 — runs in native Rust inside the Polkavm execution environment via `pallet-revive`'s cross-VM calling mechanism.

**Use case:** Cooperative membership verification. A member proves knowledge of a secret that satisfies a circuit (cooperative ID, validity window), and the protocol verifies and permanently records it on-chain without revealing the underlying data.

---

## Architecture

```
User
 │
 ▼
Next.js Frontend (TypeScript)
 │  submits: proofBytes, nullifier, cooperativeHash, validUntil, currentTime
 ▼
VerificationRegistry.sol  (EVM, Solidity)
 │  checks: expiry, nullifier replay
 │  encodes: Fr field elements as LE bytes32
 ▼
OIAP_Tracer_Caller.sol  (EVM, Solidity)
 │  staticcall via H160 address
 ▼
pvm_zk_verifier  (Polkavm, native Rust — pallet-revive)
 │  ABI dispatch on keccak256 selector
 │  Groth16 pairing: arkworks / ark-bn254
 │  VK embedded at compile time
 ▼
bool result → bubbles back → VerificationRegistry records nullifier
```

Detailed data flow and encoding specification: [`ARCHITECTURE.md`](./ARCHITECTURE.md)


## Prerequisites

| Tool | Version |
|---|---|
| Node.js | 20+ |
| npm | 10+ |
| Rust stable | latest |
| Rust nightly | required for `pvm_zk_verifier` Polkavm target |
| Rust target | `wasm32-unknown-unknown` |
| Nightly component | `rust-src` |

```bash
rustup toolchain install nightly
rustup component add rust-src --toolchain nightly
rustup target add wasm32-unknown-unknown
```

---

## Quick Start

```bash
git clone https://github.com/openaiprotocol/oaip.git
cd oaip
npm install

# Run all checks (EVM tests, lint, frontend build, all Rust builds)
npm run check:all
```

---

## Development Commands

### EVM Contracts

```bash
# Compile and run Hardhat tests
npm run test:evm
```

### Frontend

```bash
npm run lint:frontend
npm run build:frontend
```

### Rust: CLI

```bash
npm run build:prover-cli

# Also run Rust unit + integration tests
cargo test --manifest-path prover-cli/Cargo.toml
```

### Rust: Verifier Library (wasm32)

```bash
npm run build:pvm-verifier

# Run verifier library unit tests (std mode)
cargo test --manifest-path contracts/pvm_verifier/Cargo.toml
```

### Rust: On-Chain Verifier (Polkavm)

```bash
npm run build:pvm-zk-verifier
```

---

## CLI Workflows

### Step 1 — Inspect your circuit's public signal layout

Before converting a proof, verify which index corresponds to each public input:

```bash
cd prover-cli
cargo run -- detect-signals \
  --vk-json /path/to/verification_key.json \
  --public-json /path/to/public.json \
  --out-config signals_config.json
```

This prints a numbered table of signal values and writes a `signals_config.json` for downstream use.

### Step 2 — Build the Polkavm-ready Verifier Binary

This single command automatically acts on your `verification_key.json`, embeds it in the contract, and compiles the Rust contract into a `.polkavm` file ready for deployment.

```bash
cd prover-cli
cargo run -- build \
  --vk-json /path/to/verification_key.json \
  --out ./pvm_zk_verifier.polkavm
```

Outputs `pvm_zk_verifier.polkavm` to your chosen path.

### Step 3 — Convert snarkjs proof into frontend bridge JSON

```bash
cd prover-cli
cargo run -- proof-to-bridge \
  --proof-json /path/to/proof.json \
  --public-json /path/to/public.json \
  --vk-bin ../contracts/pvm_zk_verifier/keys/verification_key.bin \
  --signals-config signals_config.json \
  --write-frontend
```

Writes `frontend/public/verifier-inputs.json`. Load it in the UI via **Load Generated Inputs**.

### Mock generation (demo/testing only)

```bash
cd prover-cli
cargo run -- generate --mock --secret 0x123 --cooperative 42 --epoch 1740000000
```

---

## Deployed Contracts (Paseo Polkadot Hub Testnet)

| Contract | Address | Network |
|---|---|---|
| PVM ZK Verifier (Rust/PolkaVM) | `0x0aB10B4AC477172C1bA41Dd73d759D1AC3FEE4d1` | Paseo Testnet |
| OIAP_Tracer_Caller | `0x2C3aC8cf37411fAcA1B2E00C59eD52034869E079` | Paseo Testnet |
| VerificationRegistry | `0xAAebf33707BeB7Df70488b3357A6535198A86B8B` | Paseo Testnet |

---

## Deployment

### Step 1 — Environment setup

```bash
cp .env.example .env
# Fill in PRIVATE_KEY (must hold WND for gas)
# Get WND: https://faucet.polkadot.io/ — select Westend Asset Hub
```

### Step 2 — Deploy the PVM Rust verifier

```bash
npm run deploy:pvm
# Outputs: PVM verifier address — copy it to PVM_ADDRESS in .env
```

### Step 3 — Deploy the Solidity contracts

```bash
PVM_ADDRESS=0x<address-from-step-2> npm run deploy:contracts
# Outputs: VerificationRegistry address — set as NEXT_PUBLIC_REGISTRY_ADDRESS in frontend/.env.local
```

The frontend requires `NEXT_PUBLIC_REGISTRY_ADDRESS` pointing to the deployed `VerificationRegistry`.

---

## Benchmarks

```bash
# Local Hardhat benchmarks (gas + latency)
npm run bench
npm run bench:summary

# Network benchmarks against a live testnet RPC
npm run bench:network:testnet
npm run bench:summary:network
```

See [`BENCHMARKS.md`](./BENCHMARKS.md) for methodology and publication policy.

---

## CI

GitHub Actions runs on every push/PR:

- Hardhat EVM tests
- Frontend lint + production build
- `prover-cli` build
- `pvm_verifier` wasm32 build
- `pvm_zk_verifier` nightly Polkavm build

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Verification key embedded at compile time | Eliminates storage reads; VK is immutable per-deployment |
| `PreparedVerifyingKey` cached at first call | Avoids re-computing affine/pairing setup on every verification |
| `currentTime` is caller-supplied (not `block.timestamp`) | The ZK circuit commits to `currentTime` as a public input; expiry is enforced by `block.timestamp` in Solidity |
| Anti-spam `verificationFee` (default 0) | Operator can gate submissions without breaking permissionless defaults |
| Assembly LE encoding | Saves ~1,200 gas vs. Solidity loop for each `uint256 → bytes32` conversion |

---

## License

MIT
