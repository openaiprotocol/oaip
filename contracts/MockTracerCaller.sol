// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Test double for `OIAP_Tracer_Caller`.
///         It lets EVM tests validate `VerificationRegistry` behavior without
///         needing Polkadot Hub cross-VM routing.
contract MockTracerCaller {
    bool public result;

    bytes public lastProofBytes;
    bytes public lastPublicInputs;

    function setResult(bool _result) external {
        result = _result;
    }

    function verifyProof(bytes calldata proofBytes, bytes calldata publicInputs)
        external
        returns (bool)
    {
        lastProofBytes = proofBytes;
        lastPublicInputs = publicInputs;
        return result;
    }
}

