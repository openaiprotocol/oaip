// zk_verifier library



use ark_bn254::Bn254;
use ark_bn254::Fr;
use ark_ec::bn::{G1Affine, G2Affine};
use ark_groth16::{Groth16, Proof, VerifyingKey};
use ark_serialize::CanonicalDeserialize;

const VK_BYTES: &[u8] = include_bytes!("../keys/verification_key.bin");

/// Verifies a Groth16 proof using the provided bytes and public inputs.
pub fn verify_groth16_proof(
    proof_bytes: Vec<u8>,
    public_inputs_bytes: Vec<u8>,
) -> bool {
    let vk = match VerifyingKey::<Bn254>::deserialize_compressed(VK_BYTES) {
        Ok(vk) => vk,
        Err(_) => return false,
    };

    if proof_bytes.len() != 256 {
        return false;
    }
    let proof_a = match G1Affine::<ark_bn254::Config>::deserialize_compressed(&proof_bytes[0..64]) {
        Ok(p) => p,
        Err(_) => return false,
    };
    let proof_b = match G2Affine::<ark_bn254::Config>::deserialize_compressed(&proof_bytes[64..192]) {
        Ok(p) => p,
        Err(_) => return false,
    };
    let proof_c = match G1Affine::<ark_bn254::Config>::deserialize_compressed(&proof_bytes[192..256]) {
        Ok(p) => p,
        Err(_) => return false,
    };

    let proof = Proof::<Bn254> {
        a: proof_a.into(),
        b: proof_b.into(),
        c: proof_c.into(),
    };

    if public_inputs_bytes.len() % 32 != 0 {
        return false;
    }
    let mut public_inputs: Vec<Fr> = Vec::new();
    for chunk in public_inputs_bytes.chunks(32) {
        match Fr::deserialize_compressed(chunk) {
            Ok(fr) => public_inputs.push(fr),
            Err(_) => return false,
        }
    }

    let pvk = ark_groth16::prepare_verifying_key::<Bn254>(&vk);
    match Groth16::<Bn254>::verify_proof(&pvk, &proof, &public_inputs) {
        Ok(valid) => valid,
        Err(_) => false,
    }
}
