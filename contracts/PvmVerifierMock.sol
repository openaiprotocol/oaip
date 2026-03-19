// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal mock of the PVM verifier endpoint expected by
/// `OIAP_Tracer_Caller` (selector: verify(bytes,bytes)).
contract PvmVerifierMock {
    bool public result;

    function setResult(bool _result) external {
        result = _result;
    }

    function verify(bytes calldata, bytes calldata)
        external
        view
        returns (bool)
    {
        return result;
    }
}

