const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OIAP PVM-Native ZK Verifier - EVM Side", function () {
    let tracerCaller;
    let registry;
    let mockPvmAddress;
    let owner, addr1;

    beforeEach(async function () {
        [owner, addr1] = await ethers.getSigners();

        // 1. Deploy the Tracer Caller, pointing it to a mock address that
        //    would represent our ink! contract deployed manually on Polkadot Hub
        mockPvmAddress = owner.address; // Macking PVM caller for EVM logic tests
        const Tracer = await ethers.getContractFactory("OIAP_Tracer_Caller");
        tracerCaller = await Tracer.deploy(mockPvmAddress);

        // 2. Deploy the Registry which interacts with the Tracer Caller
        const Registry = await ethers.getContractFactory("VerificationRegistry");
        registry = await Registry.deploy(tracerCaller.target);
    });

    it("Should correctly store the PVM address in Tracer Caller", async function () {
        expect(await tracerCaller.pvmVerifierAddress()).to.equal(mockPvmAddress);
    });

    it("Registry should deploy and map to Tracer Caller", async function () {
        expect(await registry.verifier()).to.equal(tracerCaller.target);
    });

    // We skip the integration test measuring the full cross-VM byte returns
    // here because Hardhat EVM cannot emulate Polkadot Hub's `pallet-revive`
    // precompiles routing to WASM. That occurs directly on the Substrate node. 
});
