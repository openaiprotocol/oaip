// deploy-pvm-binary.cjs — Deploy the compiled .polkavm binary via Hardhat/ethers
// Run with: npx hardhat run scripts/deploy-pvm-binary.cjs --network polkadotHubTestnet
//
// Avoids shell ARG_MAX limit that breaks `cast send --create` with large bytecode.
// Reads binary path from PVM_BINARY env var (defaults to pvm_zk_verifier.polkavm).

"use strict";

const fs = require("fs");
const path = require("path");

async function main() {
  const binaryPath = process.env.PVM_BINARY || "pvm_zk_verifier.polkavm";

  if (!fs.existsSync(binaryPath)) {
    throw new Error(`PVM binary not found: ${binaryPath}\nRun 'bash scripts/deploy.sh testnet' first.`);
  }

  const provider = new hre.ethers.JsonRpcProvider(process.env.POLKADOT_HUB_TESTNET_RPC || hre.network.config.url);
  const deployer = new hre.ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const balance = await provider.getBalance(deployer.address);

  console.log(`  Binary: ${binaryPath} (${fs.statSync(binaryPath).size.toLocaleString()} bytes)`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Balance: ${hre.ethers.formatEther(balance)} PAS`);

  if (balance === 0n) {
    throw new Error(
      `Deployer wallet has zero balance.\n` +
      `Fund it at the Polkadot Faucet for Paseo Testnet\n` +
      `Address: ${deployer.address}`
    );
  }

  const bytecode = "0x" + fs.readFileSync(binaryPath).toString("hex");
  console.log("  Sending deployment transaction...");

  const tx = await deployer.sendTransaction({ data: bytecode });
  console.log(`  Tx hash: ${tx.hash}`);

  const receipt = await tx.wait();
  const contractAddress = receipt.contractAddress;

  console.log("");
  console.log("========================================");
  console.log(" PVM Verifier deployed");
  console.log("========================================");
  console.log(`  Address: ${contractAddress}`);
  console.log(`  Tx:      ${tx.hash}`);
  console.log("");
  console.log("Next step:");
  console.log(`  PVM_ADDRESS=${contractAddress} npm run deploy:contracts`);
}

main().catch((err) => {
  console.error("\nDeployment failed:", err);
  process.exit(1);
});
