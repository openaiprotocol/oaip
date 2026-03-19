use std::fs;
use std::path::{Path, PathBuf};
use std::str::FromStr;

use ark_bn254::{Bn254, Fq, Fq2, Fr, G1Affine, G2Affine};
use ark_ff::{BigInteger, PrimeField};
use ark_groth16::{Groth16, Proof, VerifyingKey};
use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};
use clap::{Args, Parser, Subcommand};
use num_bigint::BigUint;
use serde::Serialize;
use serde_json::Value;

#[derive(Parser, Debug)]
#[command(author, version, about)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Explicit mock output for hackathon/demo flow.
    Generate(GenerateArgs),
    /// Convert snarkjs verification_key.json to compressed verification_key.bin.
    VkToBin(VkToBinArgs),
    /// Convert snarkjs proof/public inputs to frontend-contract bridge JSON.
    ProofToBridge(ProofToBridgeArgs),
}

#[derive(Args, Debug)]
struct GenerateArgs {
    /// Must be set to enable mocked output.
    #[arg(long, default_value_t = false)]
    mock: bool,
    #[arg(long)]
    secret: Option<String>,
    #[arg(long)]
    cooperative: Option<u64>,
    #[arg(long)]
    epoch: Option<u64>,
}

#[derive(Args, Debug)]
struct VkToBinArgs {
    #[arg(long)]
    vk_json: PathBuf,
    #[arg(long)]
    out_pvm_verifier: Option<PathBuf>,
    #[arg(long)]
    out_pvm_zk_verifier: Option<PathBuf>,
    #[arg(long, default_value_t = false)]
    check: bool,
}

#[derive(Args, Debug)]
struct ProofToBridgeArgs {
    #[arg(long)]
    proof_json: PathBuf,
    #[arg(long)]
    public_json: PathBuf,
    #[arg(long)]
    vk_bin: Option<PathBuf>,
    #[arg(long, default_value_t = 0)]
    nullifier_index: usize,
    #[arg(long, default_value_t = 1)]
    cooperative_hash_index: usize,
    #[arg(long, default_value_t = 2)]
    valid_until_index: usize,
    #[arg(long, default_value_t = 3)]
    current_time_index: usize,
    #[arg(long)]
    out_json: Option<PathBuf>,
    #[arg(long, default_value_t = false)]
    write_frontend: bool,
}

#[derive(Serialize)]
struct BridgeOutput {
    #[serde(rename = "proofBytes")]
    proof_bytes: String,
    nullifier: String,
    #[serde(rename = "cooperativeHash")]
    cooperative_hash: String,
    #[serde(rename = "validUntil")]
    valid_until: String,
    #[serde(rename = "currentTime")]
    current_time: String,
}

fn main() {
    let cli = Cli::parse();
    let result = match cli.command {
        Commands::Generate(args) => run_generate(args),
        Commands::VkToBin(args) => run_vk_to_bin(args),
        Commands::ProofToBridge(args) => run_proof_to_bridge(args),
    };

    if let Err(e) = result {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

fn run_generate(args: GenerateArgs) -> Result<(), String> {
    if !args.mock {
        return Err(
            "Mock generation is disabled by default. Re-run with `generate --mock` or use `proof-to-bridge` with real snarkjs artifacts."
                .to_string(),
        );
    }

    let cooperative = args.cooperative.unwrap_or(0);
    let epoch = args.epoch.unwrap_or(0);
    println!(
        "Generating MOCK ZK payload for Cooperative ID: {} at Epoch: {}...",
        cooperative, epoch
    );
    println!("Note: This is mocked output. Use `proof-to-bridge` for real artifacts.");

    let mock_proof_bytes_hex = format!("0x{}", "01".repeat(256));
    let mock_public_inputs_hex = format!("0x{}", "02".repeat(128));
    println!("proof_bytes:   {}", mock_proof_bytes_hex);
    println!("public_inputs: {}", mock_public_inputs_hex);
    Ok(())
}

fn run_vk_to_bin(args: VkToBinArgs) -> Result<(), String> {
    let vk_json = read_json_file(&args.vk_json)?;
    let vk = parse_vk_from_snarkjs(&vk_json)?;

    let mut buf = Vec::new();
    vk.serialize_compressed(&mut buf)
        .map_err(|e| format!("serialize vk: {e}"))?;

    let out1 = args.out_pvm_verifier.unwrap_or_else(|| {
        PathBuf::from("../contracts/pvm_verifier/keys/verification_key.bin")
    });
    let out2 = args.out_pvm_zk_verifier.unwrap_or_else(|| {
        PathBuf::from("../contracts/pvm_zk_verifier/keys/verification_key.bin")
    });

    write_bytes_file(&out1, &buf)?;
    write_bytes_file(&out2, &buf)?;

    if args.check {
        let parsed = VerifyingKey::<Bn254>::deserialize_compressed(&buf[..])
            .map_err(|e| format!("roundtrip deserialize failed: {e}"))?;
        let mut rt = Vec::new();
        parsed
            .serialize_compressed(&mut rt)
            .map_err(|e| format!("roundtrip serialize failed: {e}"))?;
        if rt != buf {
            return Err("roundtrip bytes mismatch".to_string());
        }
    }

    println!("wrote verification key bytes:");
    println!("  {}", out1.display());
    println!("  {}", out2.display());
    Ok(())
}

fn run_proof_to_bridge(args: ProofToBridgeArgs) -> Result<(), String> {
    let proof_json = read_json_file(&args.proof_json)?;
    let public_json = read_json_file(&args.public_json)?;

    let proof_root = proof_json.get("proof").unwrap_or(&proof_json);
    let proof = parse_proof_from_snarkjs(proof_root)?;
    let public_signals = parse_public_signals(&public_json)?;

    let proof_bytes = proof_to_bytes(&proof)?;
    if proof_bytes.len() != 256 {
        return Err(format!(
            "proof bytes length mismatch: expected 256, got {}",
            proof_bytes.len()
        ));
    }

    let nullifier = public_signals
        .get(args.nullifier_index)
        .ok_or_else(|| "nullifier index out of bounds".to_string())?;
    let cooperative_hash = public_signals
        .get(args.cooperative_hash_index)
        .ok_or_else(|| "cooperative hash index out of bounds".to_string())?;
    let valid_until = public_signals
        .get(args.valid_until_index)
        .ok_or_else(|| "validUntil index out of bounds".to_string())?;
    let current_time = public_signals
        .get(args.current_time_index)
        .ok_or_else(|| "currentTime index out of bounds".to_string())?;

    if let Some(vk_path) = &args.vk_bin {
        let vk_bytes = fs::read(vk_path)
            .map_err(|e| format!("failed to read vk bin {}: {e}", vk_path.display()))?;
        let vk = VerifyingKey::<Bn254>::deserialize_compressed(&vk_bytes[..])
            .map_err(|e| format!("failed to deserialize vk bin: {e}"))?;
        let pvk = ark_groth16::prepare_verifying_key::<Bn254>(&vk);
        let ok = Groth16::<Bn254>::verify_proof(&pvk, &proof, &public_signals)
            .map_err(|e| format!("local proof verification errored: {e}"))?;
        if !ok {
            return Err("local proof verification returned false".to_string());
        }
    }

    let output = BridgeOutput {
        proof_bytes: format!("0x{}", hex::encode(proof_bytes)),
        nullifier: format!("0x{}", hex::encode(fr_to_bytes_le_32(nullifier)?)),
        cooperative_hash: format!("0x{}", hex::encode(fr_to_bytes_le_32(cooperative_hash)?)),
        valid_until: fr_to_decimal_string(valid_until)?,
        current_time: fr_to_decimal_string(current_time)?,
    };

    let pretty = serde_json::to_string_pretty(&output)
        .map_err(|e| format!("failed to serialize output json: {e}"))?;
    println!("{}", pretty);

    if let Some(path) = args.out_json {
        write_text_file(&path, &pretty)?;
        println!("wrote {}", path.display());
    }
    if args.write_frontend {
        let path = PathBuf::from("../frontend/public/verifier-inputs.json");
        write_text_file(&path, &pretty)?;
        println!("wrote {}", path.display());
    }

    Ok(())
}

fn read_json_file(path: &Path) -> Result<Value, String> {
    let text = fs::read_to_string(path)
        .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("failed to parse {}: {e}", path.display()))
}

fn write_bytes_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create dir {}: {e}", parent.display()))?;
    }
    fs::write(path, bytes).map_err(|e| format!("failed to write {}: {e}", path.display()))
}

fn write_text_file(path: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create dir {}: {e}", parent.display()))?;
    }
    fs::write(path, text).map_err(|e| format!("failed to write {}: {e}", path.display()))
}

fn parse_vk_from_snarkjs(v: &Value) -> Result<VerifyingKey<Bn254>, String> {
    let alpha_1 = parse_g1_projective(
        v.get("vk_alpha_1")
            .or_else(|| v.get("alpha_1"))
            .ok_or_else(|| "missing vk_alpha_1/alpha_1".to_string())?,
    )?;
    let beta_2 = parse_g2_projective(
        v.get("vk_beta_2")
            .or_else(|| v.get("beta_2"))
            .ok_or_else(|| "missing vk_beta_2/beta_2".to_string())?,
    )?;
    let gamma_2 = parse_g2_projective(
        v.get("vk_gamma_2")
            .or_else(|| v.get("gamma_2"))
            .ok_or_else(|| "missing vk_gamma_2/gamma_2".to_string())?,
    )?;
    let delta_2 = parse_g2_projective(
        v.get("vk_delta_2")
            .or_else(|| v.get("delta_2"))
            .ok_or_else(|| "missing vk_delta_2/delta_2".to_string())?,
    )?;

    let ic_key = if v.get("IC").is_some() { "IC" } else { "vk_ic" };
    let ic_arr = v
        .get(ic_key)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("missing {ic_key} array"))?;
    let mut gamma_abc_g1 = Vec::with_capacity(ic_arr.len());
    for entry in ic_arr {
        gamma_abc_g1.push(parse_g1_projective(entry)?);
    }

    Ok(VerifyingKey::<Bn254> {
        alpha_g1: alpha_1,
        beta_g2: beta_2,
        gamma_g2: gamma_2,
        delta_g2: delta_2,
        gamma_abc_g1,
    })
}

fn parse_proof_from_snarkjs(v: &Value) -> Result<Proof<Bn254>, String> {
    let a = parse_g1_projective(
        v.get("pi_a")
            .or_else(|| v.get("a"))
            .ok_or_else(|| "missing pi_a/a".to_string())?,
    )?;
    let b = parse_g2_projective(
        v.get("pi_b")
            .or_else(|| v.get("b"))
            .ok_or_else(|| "missing pi_b/b".to_string())?,
    )?;
    let c = parse_g1_projective(
        v.get("pi_c")
            .or_else(|| v.get("c"))
            .ok_or_else(|| "missing pi_c/c".to_string())?,
    )?;
    Ok(Proof::<Bn254> { a, b, c })
}

fn parse_public_signals(v: &Value) -> Result<Vec<Fr>, String> {
    let source = if v.is_array() {
        v
    } else {
        v.get("publicSignals")
            .ok_or_else(|| "public_json must be an array or an object with `publicSignals`".to_string())?
    };
    let arr = source
        .as_array()
        .ok_or_else(|| "public_json must be a JSON array".to_string())?;
    arr.iter()
        .map(parse_fr_value)
        .collect::<Result<Vec<_>, _>>()
}

fn parse_g1_projective(v: &Value) -> Result<G1Affine, String> {
    let arr = v
        .as_array()
        .ok_or_else(|| "G1 value must be an array".to_string())?;
    if arr.len() < 2 {
        return Err("G1 array must have at least 2 elements".to_string());
    }
    let x = parse_fq_value(&arr[0])?;
    let y = parse_fq_value(&arr[1])?;
    Ok(G1Affine::new(x, y))
}

fn parse_g2_projective(v: &Value) -> Result<G2Affine, String> {
    let arr = v
        .as_array()
        .ok_or_else(|| "G2 value must be an array".to_string())?;
    if arr.len() < 2 {
        return Err("G2 array must have at least 2 elements".to_string());
    }
    let x = parse_fq2_value(&arr[0])?;
    let y = parse_fq2_value(&arr[1])?;
    Ok(G2Affine::new(x, y))
}

fn parse_fq2_value(v: &Value) -> Result<Fq2, String> {
    let arr = v
        .as_array()
        .ok_or_else(|| "Fq2 must be an array of 2 elements".to_string())?;
    if arr.len() != 2 {
        return Err("Fq2 array must have exactly 2 elements".to_string());
    }
    // Assume snarkjs ordering: [imaginary, real].
    let c1_im = parse_fq_value(&arr[0])?;
    let c0_re = parse_fq_value(&arr[1])?;
    Ok(Fq2::new(c0_re, c1_im))
}

fn parse_fq_value(v: &Value) -> Result<Fq, String> {
    parse_field_value::<Fq>(v)
}

fn parse_fr_value(v: &Value) -> Result<Fr, String> {
    parse_field_value::<Fr>(v)
}

fn parse_field_value<F: PrimeField>(v: &Value) -> Result<F, String> {
    let s = match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => return Err("expected string/number field value".to_string()),
    };
    let bigint = parse_biguint(&s)?;
    let be = bigint.to_bytes_be();
    Ok(F::from_be_bytes_mod_order(&be))
}

fn parse_biguint(s: &str) -> Result<BigUint, String> {
    if let Some(stripped) = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
        BigUint::parse_bytes(stripped.as_bytes(), 16)
            .ok_or_else(|| format!("invalid hex integer: {s}"))
    } else {
        BigUint::from_str(s).map_err(|e| format!("invalid decimal integer {s}: {e}"))
    }
}

fn proof_to_bytes(proof: &Proof<Bn254>) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    proof
        .a
        .serialize_compressed(&mut out)
        .map_err(|e| format!("serialize proof.a failed: {e}"))?;
    proof
        .b
        .serialize_compressed(&mut out)
        .map_err(|e| format!("serialize proof.b failed: {e}"))?;
    proof
        .c
        .serialize_compressed(&mut out)
        .map_err(|e| format!("serialize proof.c failed: {e}"))?;
    Ok(out)
}

fn fr_to_bytes_le_32(fr: &Fr) -> Result<[u8; 32], String> {
    let mut out = [0u8; 32];
    let bytes = fr.into_bigint().to_bytes_le();
    if bytes.len() > 32 {
        return Err("Fr value does not fit in 32 bytes".to_string());
    }
    out[..bytes.len()].copy_from_slice(&bytes);
    Ok(out)
}

fn fr_to_decimal_string(fr: &Fr) -> Result<String, String> {
    let le = fr_to_bytes_le_32(fr)?;
    Ok(BigUint::from_bytes_le(&le).to_str_radix(10))
}
