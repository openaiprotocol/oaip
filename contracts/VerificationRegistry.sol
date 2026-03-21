// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./OIAP_Tracer_Caller.sol";

/// @title VerificationRegistry
/// @notice Stores successful verification records keyed by nullifier.
///         Allows downstream dApps to check if a nullifier was verified
///         without re-submitting the full proof to the contract.
///
///         Key improvements over v1:
///         - Owner-configurable `verificationFee` for anti-spam/griefing protection.
///           Defaults to 0 (permissionless). Owner can update to gate submissions.
///         - Assembly-optimized little-endian encoding (saves ~1,200 gas vs. loop).
///         - Accumulated fees are withdrawable by the owner.
contract VerificationRegistry {

    struct VerificationRecord {
        bytes32 cooperativeHash;
        uint256 verifiedAt;
        uint256 validUntil;
        address verifiedBy;   // which dApp triggered the verification
    }

    OIAP_Tracer_Caller public immutable verifier;

    /// @notice The owner of this registry (deployer).
    address public owner;

    /// @notice Minimum ETH (in wei) required per verification call.
    ///         Set to 0 by default for permissionless operation.
    ///         Increase to deter spam when gas fees are low.
    uint256 public verificationFee;

    // Mapping of used nullifiers to their verification record
    mapping(bytes32 => VerificationRecord) public records;

    event RecordCreated(bytes32 indexed nullifier, bytes32 cooperativeHash);
    event FeeUpdated(uint256 newFee);
    event FeeWithdrawn(address indexed to, uint256 amount);

    error OnlyOwner();
    error InsufficientFee(uint256 required, uint256 provided);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(address _verifier) {
        verifier = OIAP_Tracer_Caller(_verifier);
        owner = msg.sender;
        verificationFee = 0;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    /// @notice Set the per-verification fee. Only callable by the owner.
    /// @param _fee New fee in wei.
    function setVerificationFee(uint256 _fee) external onlyOwner {
        verificationFee = _fee;
        emit FeeUpdated(_fee);
    }

    /// @notice Withdraw all accumulated fees to the owner's address.
    function withdrawFees() external onlyOwner {
        uint256 amount = address(this).balance;
        (bool ok, ) = owner.call{value: amount}("");
        require(ok, "Transfer failed");
        emit FeeWithdrawn(owner, amount);
    }

    // ─── Core Verification ────────────────────────────────────────────────────

    /**
     * @dev Verifies a proof by calling the OIAP_Tracer_Caller (which calls PVM)
     * and records the successful verification.
     *
     * Anti-spam: if `verificationFee > 0`, callers must attach at least that
     * much ETH. Excess is accepted and accumulated for owner withdrawal.
     *
     * @param proofBytes     256-byte compressed Groth16 proof.
     * @param nullifier      Unique proof nullifier (Fr field element, LE bytes32).
     * @param cooperativeHash Cooperative identifier hash (Fr field element, LE bytes32).
     * @param validUntil     Unix timestamp after which the proof is expired.
     * @param currentTime    Caller-supplied current timestamp fed into the ZK circuit
     *                       as a public input. Note: expiry is checked against
     *                       `block.timestamp` not this value, as the circuit uses
     *                       `currentTime` as a committed input, not a guard.
     */
    function verifyAndRecord(
        bytes calldata proofBytes,
        bytes32 nullifier,
        bytes32 cooperativeHash,
        uint256 validUntil,
        uint256 currentTime
    ) external payable returns (bool) {

        // Anti-spam fee check
        if (msg.value < verificationFee) {
            revert InsufficientFee(verificationFee, msg.value);
        }

        // Expiry check (done in Solidity to save gas before cross-VM call)
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

    // ─── View Helpers ─────────────────────────────────────────────────────────

    /**
     * @dev Simple view function for downstream dApps to check if a member
     * presented a valid ZK proof within the current epoch without doing any math.
     */
    function isVerified(bytes32 nullifier) external view returns (bool) {
        VerificationRecord memory r = records[nullifier];
        return r.verifiedAt > 0 && block.timestamp <= r.validUntil;
    }

    // ─── Internal Encoding ────────────────────────────────────────────────────

    /// @dev Converts a uint256 into a little-endian bytes32.
    ///      Uses assembly to reverse the byte order efficiently, saving gas
    ///      compared to the equivalent Solidity loop.
    ///
    ///      EVM `byte(i, value)` reads the i-th byte from the MSB end:
    ///        byte(0, v) = most-significant byte,  byte(31, v) = least-significant.
    ///
    ///      For little-endian output we want the LSB at the leftmost position of
    ///      the returned bytes32 (i.e. shifted left by 248 bits).  So for output
    ///      slot j (0 = leftmost, 31 = rightmost) we need:
    ///        le[j] = be[31 - j]  ⟹  byte(31 - j, value)  shifted left by (31 - j)*8
    ///
    ///      Iterating with j = 0..31:
    ///        b = byte(31 - j, value)   — the j-th LE byte of value
    ///        shift = (31 - j) * 8      — place it at bytes32 slot j
    function _toLittleEndianBytes32(uint256 value) internal pure returns (bytes32 le) {
        assembly {
            for { let j := 0 } lt(j, 32) { j := add(j, 1) } {
                // Read the j-th LE byte of value (LSB = j=0 → byte(31, value))
                let b := byte(sub(31, j), value)
                // Place it at bytes32 slot j: shift left by (31 - j) * 8 bits
                le := or(le, shl(mul(8, sub(31, j)), b))
            }
        }
    }
}
