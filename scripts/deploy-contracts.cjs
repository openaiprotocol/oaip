// deploy-contracts.cjs — Deploy Solidity contracts to Polkadot Hub Paseo Testnet
//
// Usage:
//   PVM_ADDRESS=0x... npx hardhat run scripts/deploy-contracts.cjs --network polkadotHubTestnet
//
// Prerequisites:
//   1. Run `bash scripts/deploy.sh testnet` first — it outputs the PVM verifier address.
//   2. Set PRIVATE_KEY in .env (deployer wallet, must hold PAS for gas).
//   3. Set PVM_ADDRESS to the address output by deploy.sh.
//
// Output:
//   Prints OIAP_Tracer_Caller and VerificationRegistry addresses.
//   Append these to README.md under ## Deployed Contracts.

"use strict";

async function main() {
  const pvmAddress = process.env.PVM_ADDRESS;
  if (!pvmAddress || pvmAddress === "0x0000000000000000000000000000000000000000") {
    throw new Error(
      "PVM_ADDRESS env var is required.\n" +
      "Run `bash scripts/deploy.sh testnet` first, then:\n" +
      "  PVM_ADDRESS=0x<address> npx hardhat run scripts/deploy-contracts.cjs --network polkadotHubTestnet"
    );
  }

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("PVM verifier address:", pvmAddress);
  console.log("");

  // 1. Deploy OIAP_Tracer_Caller (cross-VM bridge)
  console.log("Deploying OIAP_Tracer_Caller...");
  const CallerFactory = await hre.ethers.getContractFactory("OIAP_Tracer_Caller");
  const caller = await CallerFactory.deploy(pvmAddress);
  await caller.waitForDeployment();
  const callerAddress = await caller.getAddress();
  console.log("  OIAP_Tracer_Caller:", callerAddress);

  // 2. Deploy VerificationRegistry (EVM entry point)
  console.log("Deploying VerificationRegistry...");
  const RegistryFactory = await hre.ethers.getContractFactory("VerificationRegistry");
  const registry = await RegistryFactory.deploy(callerAddress);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("  VerificationRegistry:", registryAddress);

  console.log("");
  console.log("========================================");
  console.log(" Deployment complete — Paseo Testnet");
  console.log("========================================");
  console.log("");
  console.log("PVM Verifier:          ", pvmAddress);
  console.log("OIAP_Tracer_Caller:    ", callerAddress);
  console.log("VerificationRegistry:  ", registryAddress);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Add these to README.md under '## Deployed Contracts (Paseo)'");
  console.log("  2. Set NEXT_PUBLIC_REGISTRY_ADDRESS=" + registryAddress + " in frontend/.env.local");
  console.log("  3. Record the tx hash from this deployment for the demo video");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
