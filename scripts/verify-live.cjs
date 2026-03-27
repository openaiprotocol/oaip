const hre = require("hardhat");

const TRACER_ABI = [
  "function verifyProof(bytes proofBytes, bytes publicInputs) external returns (bool)",
  "event VerificationResult(bool success, bool isVerified)",
];

const REGISTRY_ABI = [
  "function verifyAndRecord(bytes proofBytes, bytes32 nullifier, bytes32 cooperativeHash, uint256 validUntil, uint256 currentTime) external returns (bool)",
  "event RecordCreated(bytes32 indexed nullifier, bytes32 cooperativeHash)",
];

async function main() {
  const tracerAddress = "0x2C3aC8cf37411fAcA1B2E00C59eD52034869E079";
  const registryAddress = "0xAAebf33707BeB7Df70488b3357A6535198A86B8B";

  const [signer] = await hre.ethers.getSigners();
  const tracer = new hre.ethers.Contract(tracerAddress, TRACER_ABI, signer);

  // Using simple bytes for testing
  const proofBytes = "0x01010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101";
  const publicInputs = "0x0202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202020202";

  console.log("Sending verifyProof tx to Tracer Caller...");
  const tx = await tracer.verifyProof(proofBytes, publicInputs, { gasLimit: 2000000 });
  console.log("Tx hash:", tx.hash);

  const receipt = await tx.wait();
  console.log("Status:", receipt.status === 1 ? "SUCCESS" : "REVERTED");
  console.log("Gas used:", receipt.gasUsed.toString());
  
  if (receipt.status === 1) {
    console.log("Events:", receipt.logs);
  }
}

main().catch(console.error);
