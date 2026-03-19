// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./pvm_zk_verifier/IZKVerifier.sol";

/**
 * @title OIAP_Tracer_Caller
 * @notice Solidity entry point for the PVM-Native ZK Verifier.
 *
 * Cross-VM calling conventions on Polkadot Hub (pallet-revive):
 *   - PVM contracts are accessible at an H160 address via Revive.
 *   - Calldata is ABI-encoded with a standard keccak256 4-byte selector,
 *     matching the Solidity interface in IZKVerifier.sol.
 *   - The PVM contract dispatches on this selector (NOT BLAKE2).
 */
contract OIAP_Tracer_Caller {

    /// @dev Address of the deployed PVM (Rust RISC-V) verifier contract.
    ///      Set this to the address output by scripts/deploy.sh after deployment.
    address public pvmVerifierAddress;

    // keccak256("verify(bytes,bytes)") — first 4 bytes.
    // This is the selector the Rust PVM contract dispatches on.
    bytes4 public constant VERIFY_SELECTOR = IZKVerifier.verify.selector;

    event VerificationResult(bool success, bool isVerified);

    constructor(address _pvmVerifierAddress) {
        require(_pvmVerifierAddress != address(0), "Invalid PVM address");
        pvmVerifierAddress = _pvmVerifierAddress;
    }

    /**
     * @notice Verifies a Groth16 ZK proof by cross-VM calling the PVM Rust verifier.
     * @param proofBytes    256-byte compressed Groth16 proof (G1[64] + G2[128] + G1[64])
     * @param publicInputs  ABI-encoded Fr field elements (n x 32 bytes)
     * @return isVerified   True if the proof is valid per the embedded verification key
     */
    function verifyProof(
        bytes calldata proofBytes,
        bytes calldata publicInputs
    ) external returns (bool isVerified) {
        // ABI-encode using the keccak256 selector so the PVM contract can dispatch.
        bytes memory callData = abi.encodeWithSelector(
            VERIFY_SELECTOR,
            proofBytes,
            publicInputs
        );

        // staticcall because ZK verification is read-only: it validates the proof
        // against the embedded VK and returns a boolean — no state mutation.
        (bool success, bytes memory returnData) = pvmVerifierAddress.staticcall(callData);

        require(success, "Cross-VM call to PVM verifier failed");

        // Decode the 32-byte ABI bool returned by the Rust contract.
        isVerified = abi.decode(returnData, (bool));

        emit VerificationResult(success, isVerified);
    }
}
