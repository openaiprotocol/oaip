// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./OIAP_Tracer_Caller.sol";

/// @title VerificationRegistry
/// @notice Stores successful verification records keyed by nullifier.
///         Allows downstream dApps to check if a nullifier was verified
///         without re-submitting the full proof to the contract.
contract VerificationRegistry {

    struct VerificationRecord {
        bytes32 cooperativeHash;
        uint256 verifiedAt;
        uint256 validUntil;
        address verifiedBy;   // which dApp triggered the verification
    }

    OIAP_Tracer_Caller public immutable verifier;

    // Mapping of used nullifiers to their verification record
    mapping(bytes32 => VerificationRecord) public records;

    event RecordCreated(bytes32 indexed nullifier, bytes32 cooperativeHash);

    constructor(address _verifier) {
        verifier = OIAP_Tracer_Caller(_verifier);
    }

    /**
     * @dev Verifies a proof by calling the OIAP_Tracer_Caller (which calls PVM)
     * and records the successful verification.
     */
    function verifyAndRecord(
        bytes calldata proofBytes,
        bytes32 nullifier,
        bytes32 cooperativeHash,
        uint256 validUntil,
        uint256 currentTime
    ) external returns (bool) {
        
        // Expiry check (done in Solidity to save any gas before cross-VM call)
        require(block.timestamp <= validUntil, "Proof is expired");
        require(records[nullifier].verifiedAt == 0, "Nullifier already used");

        // Public inputs layout (4 x Fr elements, 32 bytes each):
        //  - nullifier
        //  - cooperativeHash
        //  - validUntil (little-endian bytes32)
        //  - currentTime (little-endian bytes32, caller-supplied)
        bytes memory publicInputs = abi.encodePacked(
            nullifier,
            cooperativeHash,
            _toLittleEndianBytes32(validUntil),
            _toLittleEndianBytes32(currentTime)
        );

        // The Tracer Caller accepts the raw bytes and sends them to PVM
        bool valid = verifier.verifyProof(proofBytes, publicInputs);
        
        if (valid) {
            records[nullifier] = VerificationRecord({
                cooperativeHash: cooperativeHash,
                verifiedAt:      block.timestamp,
                validUntil:      validUntil,
                verifiedBy:      msg.sender
            });
            emit RecordCreated(nullifier, cooperativeHash);
        }
        
        return valid;
    }

    function _toLittleEndianBytes32(uint256 value) internal pure returns (bytes32 le) {
        for (uint256 i = 0; i < 32; i++) {
            uint256 b = (value >> (8 * i)) & 0xff;
            le |= bytes32(b << (248 - (8 * i)));
        }
    }

    /**
     * @dev Simple view function for downstream dApps to check if a member
     * presented a valid ZK proof within the current epoch without doing any math.
     */
    function isVerified(bytes32 nullifier) external view returns (bool) {
        VerificationRecord memory r = records[nullifier];
        return r.verifiedAt > 0 && block.timestamp <= r.validUntil;
    }
}
