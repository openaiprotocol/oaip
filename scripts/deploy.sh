#!/usr/bin/env bash
# deploy.sh — PVM ZK Verifier Deployment Pipeline
# Usage: ./scripts/deploy.sh [testnet|local]
#
# Prerequisites:
#   - cargo + nightly (builds using included JSON target spec via `-Z json-target-spec`)
#   - polkatool  (install: cargo install polkatool)
#   - cast       (install: https://getfoundry.sh)
#   - PRIVATE_KEY env var set (via .env or export)

set -e

NETWORK=${1:-local}
CONTRACT_DIR="contracts/pvm_zk_verifier"
OUTPUT_NAME="pvm_zk_verifier"
TARGET_JSON="$CONTRACT_DIR/riscv64emac-unknown-none-polkavm.json"

echo "========================================"
echo " OIAP PVM ZK Verifier — Deploy Script"
echo " Network: $NETWORK"
echo "========================================"

# ─── Step 1: Install RISC-V toolchain if needed ───────────────────────────────
echo "[1/4] Checking RISC-V toolchain..."
if ! rustup toolchain list | grep -q "nightly"; then
    echo "  Installing nightly toolchain..."
    rustup toolchain install nightly
fi
rustup component add rust-src --toolchain nightly
echo "  OK: Toolchain ready."

# ─── Step 2: Build the RISC-V ELF ────────────────────────────────────────────
echo "[2/4] Building RISC-V ELF..."
(
    cd "$CONTRACT_DIR"
    cargo +nightly build \
        --target "$TARGET_JSON" \
        --release \
        -Z build-std=core,alloc \
        -Z json-target-spec
)
ELF_PATH="$CONTRACT_DIR/target/riscv64emac-unknown-none-polkavm/release/$OUTPUT_NAME"
echo "  OK: ELF built: $ELF_PATH"

# ─── Step 3: polkatool — produce the deployable .polkavm artifact ─────────────
# polkatool performs tree-shaking and reformatting of the ELF into the
# custom PolkaVM binary format that pallet-revive accepts.
echo "[3/4] Running polkatool to produce .polkavm artifact..."
if ! command -v polkatool &> /dev/null; then
    echo "  Installing polkatool..."
    cargo install polkatool
fi
polkatool link "$ELF_PATH" -o "${OUTPUT_NAME}.polkavm"
echo "  OK: Artifact: ${OUTPUT_NAME}.polkavm ($(du -sh ${OUTPUT_NAME}.polkavm | cut -f1))"

# ─── Step 4: Deploy to the network ───────────────────────────────────────────
echo "[4/4] Deploying to $NETWORK..."

if [ "$NETWORK" == "testnet" ]; then
    RPC_URL="${POLKADOT_HUB_TESTNET_RPC:-https://westend-asset-hub-eth-rpc.polkadot.io}"
elif [ "$NETWORK" == "local" ]; then
    RPC_URL="http://127.0.0.1:8545"
else
    echo "  Unknown network: $NETWORK"
    exit 1
fi

# Encode the .polkavm binary as hex and deploy via cast
BYTECODE=$(xxd -p -c 99999 "${OUTPUT_NAME}.polkavm")
DEPLOYED_ADDRESS=$(cast send \
    --rpc-url "$RPC_URL" \
    --private-key "$PRIVATE_KEY" \
    --create "0x${BYTECODE}" \
    --json | jq -r '.contractAddress')

echo "  OK: Deployed at: $DEPLOYED_ADDRESS"
echo ""
echo "  IMPORTANT: Copy this address into OIAP_Tracer_Caller.sol:"
echo "    address public constant INK_VERIFIER = $DEPLOYED_ADDRESS;"
echo ""
echo "========================================"
echo " Deployment complete."
echo "========================================"
