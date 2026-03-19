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
});

