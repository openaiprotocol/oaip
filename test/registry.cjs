const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("VerificationRegistry - EVM logic", function () {
  let registry;
  let tracerMock;
  let owner;
  let addr1;

  beforeEach(async function () {
    [owner, addr1] = await ethers.getSigners();

    const TracerMock = await ethers.getContractFactory("MockTracerCaller");
    tracerMock = await TracerMock.deploy();

    const Registry = await ethers.getContractFactory("VerificationRegistry");
    registry = await Registry.deploy(tracerMock.target);
  });

  const toLeBytes32 = (value) => {
    const be = ethers.zeroPadValue(ethers.toBeHex(value), 32);
    const bytes = ethers.getBytes(be);
    return ethers.hexlify(Uint8Array.from(bytes).reverse());
  };

  // ─── Existing Tests ─────────────────────────────────────────────────────────

  it("reverts when proof is expired", async function () {
    // validUntil < block.timestamp
    const { timestamp } = await ethers.provider.getBlock("latest");
    const validUntil = timestamp - 1;

    const currentTime = validUntil - 10;
    await expect(
      registry
        .connect(addr1)
        .verifyAndRecord(
          "0x1234",
          ethers.zeroPadValue(addr1.address, 32),
          ethers.zeroPadValue(owner.address, 32),
          validUntil,
          currentTime
        )
    ).to.be.revertedWith("Proof is expired");
  });

  it("records verification only when tracer returns true", async function () {
    const nullifier = ethers.zeroPadValue(addr1.address, 32);
    const coopHash = ethers.zeroPadValue(owner.address, 32);

    // Pick a validUntil safely in the future
    const { timestamp } = await ethers.provider.getBlock("latest");
    const validUntil = timestamp + 3600;
    const currentTime = timestamp;

    // tracer returns false -> no record
    await tracerMock.setResult(false);
    await registry
      .connect(addr1)
      .verifyAndRecord("0x1234", nullifier, coopHash, validUntil, currentTime);

    const r0 = await registry.records(nullifier);
    expect(r0.verifiedAt).to.equal(0);

    // tracer returns true -> record created
    await tracerMock.setResult(true);
    await registry
      .connect(addr1)
      .verifyAndRecord("0x1234", nullifier, coopHash, validUntil, currentTime);

    const expectedPublicInputs = ethers.concat([
      nullifier,
      coopHash,
      toLeBytes32(validUntil),
      toLeBytes32(currentTime),
    ]);
    expect(await tracerMock.lastPublicInputs()).to.equal(expectedPublicInputs);

    const r1 = await registry.records(nullifier);
    expect(r1.verifiedAt).to.be.gt(0);
    expect(r1.cooperativeHash).to.equal(coopHash);
    expect(r1.validUntil).to.equal(validUntil);
    expect(r1.verifiedBy).to.equal(addr1.address);
  });

  it("prevents nullifier replay", async function () {
    const nullifier = ethers.zeroPadValue(addr1.address, 32);
    const coopHash = ethers.zeroPadValue(owner.address, 32);

    const { timestamp } = await ethers.provider.getBlock("latest");
    const validUntil = timestamp + 3600;
    const currentTime = timestamp;

    await tracerMock.setResult(true);
    await registry
      .connect(addr1)
      .verifyAndRecord("0x1234", nullifier, coopHash, validUntil, currentTime);

    await expect(
      registry
        .connect(addr1)
        .verifyAndRecord("0x1234", nullifier, coopHash, validUntil, currentTime)
    ).to.be.revertedWith("Nullifier already used");
  });

  // ─── New Tests: isVerified ──────────────────────────────────────────────────

  it("isVerified returns true within valid window", async function () {
    const nullifier = ethers.zeroPadValue(addr1.address, 32);
    const coopHash = ethers.zeroPadValue(owner.address, 32);

    const { timestamp } = await ethers.provider.getBlock("latest");
    const validUntil = timestamp + 3600;
    const currentTime = timestamp;

    // Confirm not verified before submission
    expect(await registry.isVerified(nullifier)).to.equal(false);

    await tracerMock.setResult(true);
    await registry
      .connect(addr1)
      .verifyAndRecord("0x1234", nullifier, coopHash, validUntil, currentTime);

    // Now verified within the window
    expect(await registry.isVerified(nullifier)).to.equal(true);
  });

  it("isVerified returns false for unknown nullifier", async function () {
    const unknownNullifier = ethers.zeroPadValue("0xdeadbeef", 32);
    expect(await registry.isVerified(unknownNullifier)).to.equal(false);
  });

  // ─── New Tests: Anti-Spam Fee ───────────────────────────────────────────────

  it("owner can set a verification fee", async function () {
    const fee = ethers.parseEther("0.01");
    await expect(registry.connect(owner).setVerificationFee(fee))
      .to.emit(registry, "FeeUpdated")
      .withArgs(fee);
    expect(await registry.verificationFee()).to.equal(fee);
  });

  it("non-owner cannot set a verification fee", async function () {
    const fee = ethers.parseEther("0.01");
    await expect(
      registry.connect(addr1).setVerificationFee(fee)
    ).to.be.revertedWithCustomError(registry, "OnlyOwner");
  });

  it("reverts when caller sends insufficient fee", async function () {
    const fee = ethers.parseEther("0.01");
    await registry.connect(owner).setVerificationFee(fee);

    const nullifier = ethers.zeroPadValue(addr1.address, 32);
    const coopHash = ethers.zeroPadValue(owner.address, 32);
    const { timestamp } = await ethers.provider.getBlock("latest");
    const validUntil = timestamp + 3600;

    await expect(
      registry
        .connect(addr1)
        .verifyAndRecord("0x1234", nullifier, coopHash, validUntil, timestamp, {
          value: ethers.parseEther("0.001"), // too low
        })
    ).to.be.revertedWithCustomError(registry, "InsufficientFee");
  });

  it("succeeds when caller sends sufficient fee and fee accumulates", async function () {
    const fee = ethers.parseEther("0.01");
    await registry.connect(owner).setVerificationFee(fee);
    await tracerMock.setResult(true);

    const nullifier = ethers.zeroPadValue(addr1.address, 32);
    const coopHash = ethers.zeroPadValue(owner.address, 32);
    const { timestamp } = await ethers.provider.getBlock("latest");
    const validUntil = timestamp + 3600;

    // Should succeed with exact fee
    await registry
      .connect(addr1)
      .verifyAndRecord("0x1234", nullifier, coopHash, validUntil, timestamp, {
        value: fee,
      });

    // Contract balance should reflect the fee
    const balance = await ethers.provider.getBalance(registry.target);
    expect(balance).to.equal(fee);
  });

  it("owner can withdraw accumulated fees", async function () {
    const fee = ethers.parseEther("0.01");
    await registry.connect(owner).setVerificationFee(fee);
    await tracerMock.setResult(true);

    const nullifier = ethers.zeroPadValue(addr1.address, 32);
    const coopHash = ethers.zeroPadValue(owner.address, 32);
    const { timestamp } = await ethers.provider.getBlock("latest");
    const validUntil = timestamp + 3600;

    await registry
      .connect(addr1)
      .verifyAndRecord("0x1234", nullifier, coopHash, validUntil, timestamp, {
        value: fee,
      });

    const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);
    const tx = await registry.connect(owner).withdrawFees();
    const receipt = await tx.wait();
    const gasUsed = receipt.gasUsed * receipt.gasPrice;
    const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);

    // Owner should have received the 0.01 ETH (minus gas)
    expect(ownerBalanceAfter).to.be.closeTo(
      ownerBalanceBefore + fee - gasUsed,
      ethers.parseEther("0.001") // allow 0.001 ETH tolerance for gas fluctuation
    );

    // Contract balance should be zero
    const contractBalance = await ethers.provider.getBalance(registry.target);
    expect(contractBalance).to.equal(0);
  });

  // ─── Assembly LE Encoding Correctness ─────────────────────────────────────

  it("assembly LE encoding matches the reference JS implementation", async function () {
    const nullifier = ethers.zeroPadValue(addr1.address, 32);
    const coopHash = ethers.zeroPadValue(owner.address, 32);
    const { timestamp } = await ethers.provider.getBlock("latest");
    const validUntil = timestamp + 3600;
    const currentTime = timestamp;

    await tracerMock.setResult(true);
    await registry
      .connect(addr1)
      .verifyAndRecord("0x1234", nullifier, coopHash, validUntil, currentTime);

    // Reconstruct what the registry should have sent as publicInputs
    const expectedPublicInputs = ethers.concat([
      nullifier,
      coopHash,
      toLeBytes32(validUntil),
      toLeBytes32(currentTime),
    ]);

    expect(await tracerMock.lastPublicInputs()).to.equal(expectedPublicInputs);
  });
});
