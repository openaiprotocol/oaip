// zk_verifier library

use ark_bn254::Bn254;
use ark_bn254::Fr;
use ark_ec::bn::{G1Affine, G2Affine};
use ark_groth16::{Groth16, PreparedVerifyingKey, Proof, VerifyingKey};
use ark_serialize::CanonicalDeserialize;

#[cfg(feature = "std")]
use std::sync::OnceLock;

const VK_BYTES: &[u8] = include_bytes!("../keys/verification_key.bin");

/// Returns a reference to the globally-cached `PreparedVerifyingKey`.
///
/// The VK is embedded at compile time and is immutable; deserializing and
/// calling `prepare_verifying_key` is expensive (several ms on bench hardware).
/// We do it exactly once, paying that cost on the very first verification call,
/// and re-use the result for every subsequent call within the same process.
///
/// When the library is compiled without `std` (e.g. `wasm32-unknown-unknown`
/// with `--no-default-features`) the cache is omitted and the VK is parsed on
/// every call, which is the safe conservative fallback for that target.
#[cfg(feature = "std")]
fn get_pvk() -> Option<&'static PreparedVerifyingKey<Bn254>> {
    static PVK: OnceLock<Option<PreparedVerifyingKey<Bn254>>> = OnceLock::new();
    PVK.get_or_init(|| {
        VerifyingKey::<Bn254>::deserialize_compressed(VK_BYTES)
            .ok()
            .map(|vk| ark_groth16::prepare_verifying_key::<Bn254>(&vk))
    })
    .as_ref()
}

#[cfg(not(feature = "std"))]
fn build_pvk() -> Option<PreparedVerifyingKey<Bn254>> {
    VerifyingKey::<Bn254>::deserialize_compressed(VK_BYTES)
        .ok()
        .map(|vk| ark_groth16::prepare_verifying_key::<Bn254>(&vk))
}

/// Verifies a Groth16 proof using the provided bytes and public inputs.
///
/// # Arguments
/// * `proof_bytes`        — 256 bytes: G1(64) + G2(128) + G1(64), compressed Arkworks format.
/// * `public_inputs_bytes` — n × 32 bytes, each a little-endian Fr field element.
///
/// Returns `false` on *any* parse or verification error, never panics.
pub fn verify_groth16_proof(
    proof_bytes: Vec<u8>,
    public_inputs_bytes: Vec<u8>,
) -> bool {
    // ── Obtain PVK ───────────────────────────────────────────────────────────
    #[cfg(feature = "std")]
    let pvk = match get_pvk() {
        Some(p) => p,
        None => return false,
    };

    #[cfg(not(feature = "std"))]
    let owned_pvk = match build_pvk() {
        Some(p) => p,
        None => return false,
    };
    #[cfg(not(feature = "std"))]
    let pvk = &owned_pvk;

    // ── Parse proof ──────────────────────────────────────────────────────────
    if proof_bytes.len() != 256 {
        return false;
    }
    let proof_a = match G1Affine::<ark_bn254::Config>::deserialize_compressed(&proof_bytes[0..64]) {
        Ok(p) => p,
        Err(_) => return false,
    };
    let proof_b =
        match G2Affine::<ark_bn254::Config>::deserialize_compressed(&proof_bytes[64..192]) {
            Ok(p) => p,
            Err(_) => return false,
        };
    let proof_c =
        match G1Affine::<ark_bn254::Config>::deserialize_compressed(&proof_bytes[192..256]) {
            Ok(p) => p,
            Err(_) => return false,
        };

    let proof = Proof::<Bn254> {
        a: proof_a.into(),
        b: proof_b.into(),
        c: proof_c.into(),
    };

    // ── Parse public inputs ──────────────────────────────────────────────────
    if public_inputs_bytes.is_empty() || public_inputs_bytes.len() % 32 != 0 {
        return false;
    }
    let mut public_inputs: Vec<Fr> = Vec::new();
    for chunk in public_inputs_bytes.chunks(32) {
        match Fr::deserialize_compressed(chunk) {
            Ok(fr) => public_inputs.push(fr),
            Err(_) => return false,
        }
    }

    // ── Groth16 pairing verification ─────────────────────────────────────────
    match Groth16::<Bn254>::verify_proof(pvk, &proof, &public_inputs) {
        Ok(valid) => valid,
        Err(_) => false,
    }
}

// =============================================================================
// Unit tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: build a zeroed-out `proof_bytes` vec of the given length.
    fn zero_proof(len: usize) -> Vec<u8> {
        vec![0u8; len]
    }

    /// Helper: build a zeroed-out `public_inputs_bytes` vec of the given length.
    fn zero_pub(len: usize) -> Vec<u8> {
        vec![0u8; len]
    }

    #[test]
    fn rejects_empty_proof() {
        // Zero bytes — clearly not a valid proof.
        assert!(!verify_groth16_proof(vec![], zero_pub(32)));
    }

    #[test]
    fn rejects_wrong_length_proof_too_short() {
        // 128 bytes is half the expected 256 — must be rejected before any EC math.
        assert!(!verify_groth16_proof(zero_proof(128), zero_pub(32)));
    }

    #[test]
    fn rejects_wrong_length_proof_too_long() {
        // 512 bytes — also wrong.
        assert!(!verify_groth16_proof(zero_proof(512), zero_pub(32)));
    }

    #[test]
    fn rejects_malformed_g1_point() {
        // 256 bytes but all-zero: not on the BN254 curve, so deserialization
        // (compressed point decode) must fail → returns false.
        assert!(!verify_groth16_proof(zero_proof(256), zero_pub(32)));
    }

    #[test]
    fn rejects_empty_public_inputs() {
        // Proof length is right, but no public inputs provided.
        assert!(!verify_groth16_proof(zero_proof(256), vec![]));
    }

    #[test]
    fn rejects_misaligned_public_inputs() {
        // 33 bytes is not divisible by 32 → rejected before Fr parsing.
        assert!(!verify_groth16_proof(zero_proof(256), zero_pub(33)));
    }

    #[test]
    fn rejects_malformed_fr_element() {
        // A valid-size chunk but filled with 0xff: larger than the BN254 field
        // modulus, so Fr deserialization must fail → returns false.
        let bad_fr = vec![0xffu8; 32];
        assert!(!verify_groth16_proof(zero_proof(256), bad_fr));
    }
}
