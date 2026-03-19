#![no_std]
#![no_main]

extern crate alloc;
use alloc::vec;
use alloc::vec::Vec;

use picoalloc::{Allocator, Array, ArrayPointer, Env, Mutex, Size};

// ─── Heap allocator (no_std) ───────────────────────────────────────────────
// We provide a small static heap for `alloc` types (`Vec`) in the PVM
// environment. `picoalloc::Allocator` requires an `Env` type, which we wrap
// to satisfy `Send`/`Sync` bounds for the `#[global_allocator]` static.
const HEAP_SIZE: usize = 1024 * 1024; // 1MiB

static mut HEAP: Array<HEAP_SIZE> = Array([0u8; HEAP_SIZE]);

#[repr(transparent)]
struct SafeArrayPointer<const SIZE: usize>(ArrayPointer<SIZE>);

unsafe impl<const SIZE: usize> Send for SafeArrayPointer<SIZE> {}
unsafe impl<const SIZE: usize> Sync for SafeArrayPointer<SIZE> {}

impl<const SIZE: usize> Env for SafeArrayPointer<SIZE> {
    fn total_space(&self) -> Size {
        self.0.total_space()
    }

    unsafe fn allocate_address_space(&mut self) -> *mut u8 {
        self.0.allocate_address_space()
    }

    unsafe fn expand_memory_until(&mut self, base: *mut u8, size: Size) -> bool {
        self.0.expand_memory_until(base, size)
    }

    unsafe fn free_address_space(&mut self, base: *mut u8) {
        self.0.free_address_space(base)
    }
}

#[global_allocator]
static ALLOCATOR: Mutex<Allocator<SafeArrayPointer<HEAP_SIZE>>> = Mutex::new(unsafe {
    Allocator::new(SafeArrayPointer(ArrayPointer::new(&raw mut HEAP as *mut _)))
});

// ─── pallet-revive host functions ────────────────────────────────────────────
use pallet_revive_uapi::{HostFn, HostFnImpl as api, ReturnFlags};

// ─── ABI selector dispatch ───────────────────────────────────────────────────
// alloy-sol-types generates the keccak256 4-byte selector from the Solidity
// interface, matching what the Solidity caller uses in abi.encodeWithSelector.
use alloy_sol_types::sol;
use alloy_sol_types::SolCall;

// ─── ZK cryptography ─────────────────────────────────────────────────────────
use ark_bn254::Bn254;
use ark_bn254::Fr;
use ark_ec::bn::{G1Affine, G2Affine};
use ark_groth16::{Groth16, Proof, VerifyingKey};
use ark_serialize::CanonicalDeserialize;

// Verification key embedded at compile time.
// Replace with real binary from: snarkjs zkey export verificationkey ... | vk_to_bin
const VK_BYTES: &[u8] = include_bytes!("../keys/verification_key.bin");

// Generate the IZKVerifier ABI bindings from the Solidity interface.
// This gives us `IZKVerifier::verifyCall::SELECTOR` (keccak256-based, 4 bytes).
sol!("IZKVerifier.sol");

// ─── Contract entrypoints ─────────────────────────────────────────────────────

/// Called by pallet-revive when an existing contract is invoked.
#[no_mangle]
pub extern "C" fn call() {
    // Step 1: Read the calldata length from the host.
    let len = api::call_data_size() as usize;

    if len < 4 {
        api::return_value(ReturnFlags::REVERT, b"calldata too short");
    }

    // Step 2: Copy calldata into our heap-allocated buffer.
    let mut call_data = vec![0u8; len];
    api::call_data_copy(&mut call_data, 0);

    // Step 3: Parse the 4-byte keccak256 selector.
    let selector: [u8; 4] = call_data[0..4].try_into().unwrap_or([0u8; 4]);

    // Step 4: Dispatch to the correct handler.
    match selector {
        IZKVerifier::verifyCall::SELECTOR => {
            // The Solidity caller ABI-encodes (proofBytes, publicInputs).
            // call_data[4..] is the ABI payload; parse accordingly.
            let result = verify_proof(&call_data[4..]);

            // Return a 32-byte ABI-compatible bool (right-padded).
            let mut return_data = [0u8; 32];
            return_data[31] = result as u8;
            api::return_value(ReturnFlags::empty(), &return_data);
        }
        _ => {
            api::return_value(ReturnFlags::REVERT, b"unknown selector");
        }
    }
}

/// Called by pallet-revive once when the contract is first deployed.
#[no_mangle]
pub extern "C" fn deploy() {
    // No storage to initialise — VK is embedded at compile time.
}

// ─── Verification logic ───────────────────────────────────────────────────────

/// Deserialise and verify a Groth16 proof.
///
/// Expected layout of `input` (post-selector, ABI-encoded):
///   [0..64]   proof_a  — G1 compressed
///   [64..192] proof_b  — G2 compressed
///   [192..256] proof_c — G1 compressed
///   [256..]   public_inputs — n×32-byte Fr field elements
fn verify_proof(input: &[u8]) -> bool {
    // The calldata payload is ABI-encoded for:
    //   verify(bytes proofBytes, bytes publicInputs)
    //
    // Layout (after the 4-byte selector):
    //   word0: offset_to_proof (uint256, big-endian)
    //   word1: offset_to_public_inputs (uint256, big-endian)
    //   at offset_to_proof:
    //     word: proof_len (uint256)
    //     bytes: proof bytes (padded to 32 bytes)
    //   at offset_to_public_inputs:
    //     word: public_len (uint256)
    //     bytes: public input bytes (padded to 32 bytes)
    if input.len() < 64 {
        return false;
    }

    fn read_word_u64_be(buf: &[u8], offset: usize) -> Option<u64> {
        if buf.len() < offset + 32 {
            return None;
        }
        // Require the value to fit into u64 (upper 192 bits must be zero).
        for i in 0..24 {
            if buf[offset + i] != 0 {
                return None;
            }
        }
        let mut v: u64 = 0;
        for i in 0..8 {
            v = (v << 8) | (buf[offset + 24 + i] as u64);
        }
        Some(v)
    }

    let proof_off = match read_word_u64_be(input, 0) {
        Some(v) => v as usize,
        None => return false,
    };
    let public_off = match read_word_u64_be(input, 32) {
        Some(v) => v as usize,
        None => return false,
    };

    if proof_off + 32 > input.len() || public_off + 32 > input.len() {
        return false;
    }

    let proof_len = match read_word_u64_be(input, proof_off) {
        Some(v) => v as usize,
        None => return false,
    };
    let public_len = match read_word_u64_be(input, public_off) {
        Some(v) => v as usize,
        None => return false,
    };

    let proof_start = proof_off + 32;
    let public_start = public_off + 32;
    if proof_start + proof_len > input.len() || public_start + public_len > input.len() {
        return false;
    }

    let proof_bytes = &input[proof_start..proof_start + proof_len];
    let public_input_bytes = &input[public_start..public_start + public_len];

    // Sanity checks for our expected proof format.
    if proof_bytes.len() != 256 {
        return false;
    }

    // Deserialise verification key embedded at compile time.
    let vk = match VerifyingKey::<Bn254>::deserialize_compressed(VK_BYTES) {
        Ok(v) => v,
        Err(_) => return false,
    };

    // Parse proof components.
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

    // Parse public inputs — each is a 32-byte Fr field element.
    if public_input_bytes.is_empty() {
        return false;
    }
    if public_input_bytes.len() % 32 != 0 {
        return false;
    }

    let mut public_inputs: Vec<Fr> = Vec::new();
    for chunk in public_input_bytes.chunks(32) {
        match Fr::deserialize_compressed(chunk) {
            Ok(fr) => public_inputs.push(fr),
            Err(_) => return false,
        }
    }

    // Execute Groth16 pairing verification — this is the PVM-native computation.
    let pvk = ark_groth16::prepare_verifying_key::<Bn254>(&vk);
    match Groth16::<Bn254>::verify_proof(&pvk, &proof, &public_inputs) {
        Ok(valid) => valid,
        Err(_) => false,
    }
}
