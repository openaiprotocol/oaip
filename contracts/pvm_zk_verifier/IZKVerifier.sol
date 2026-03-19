// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IZKVerifier
/// @notice Interface for the PVM-native ZK verifier contract.
///         This file is used both for Solidity interaction and for
///         generating keccak256 selectors via alloy-sol-types in the
///         Rust PVM contract.
interface IZKVerifier {
    /// @notice Verify a Groth16 cooperative membership proof.
    /// @param proofBytes     Compressed Groth16 proof (256 bytes: a[64]+b[128]+c[64])
    /// @param publicInputs   ABI-encoded public inputs as Fr field elements (4 x 32 bytes)
    /// @return valid         True if the proof is valid for the embedded verification key.
    function verify(
        bytes calldata proofBytes,
        bytes calldata publicInputs
    ) external returns (bool valid);
}
