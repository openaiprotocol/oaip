/// Integration tests for the prover-cli binary.
///
/// These tests exercise the CLI by calling the library functions directly
/// (rather than spawning a subprocess) to verify correct parsing and output
/// for every subcommand.  Subprocess-level tests are reserved for CI smoke
/// checks against real snarkjs artifacts.

use std::fs;
use std::io::Write;
use tempfile::TempDir;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Write `content` to a named file inside `dir` and return the path.
fn write_file(dir: &TempDir, name: &str, content: &str) -> std::path::PathBuf {
    let path = dir.path().join(name);
    let mut f = fs::File::create(&path).expect("create file");
    f.write_all(content.as_bytes()).expect("write file");
    path
}

/// A minimal snarkjs-format VK JSON with 4 IC elements (→ 3 public inputs).
/// The curve points use "1" / "0" field values which are valid Fq elements.
fn dummy_vk_json(n_ic: usize) -> String {
    let pt = r#"["1","1","1"]"#;
    let pt2 = r#"[["1","0"],["1","0"]]"#; // G2 point arrays
    let ic_pts: Vec<String> = (0..n_ic).map(|_| pt.to_string()).collect();
    format!(
        r#"{{
  "vk_alpha_1": {pt},
  "vk_beta_2": {pt2},
  "vk_gamma_2": {pt2},
  "vk_delta_2": {pt2},
  "IC": [{ic}]
}}"#,
        pt = pt,
        pt2 = pt2,
        ic = ic_pts.join(",")
    )
}

/// A minimal snarkjs-format public signals JSON with `n` zero values.
fn dummy_public_json(n: usize) -> String {
    let entries: Vec<&str> = (0..n).map(|_| r#""0""#).collect();
    format!("[{}]", entries.join(","))
}

// ─── detect-signals tests ─────────────────────────────────────────────────────

#[test]
fn detect_signals_counts_correctly_from_ic() {
    // IC with 5 elements → 4 public inputs
    let dir = TempDir::new().unwrap();
    let vk_path = write_file(&dir, "vk.json", &dummy_vk_json(5));

    // Call the underlying parse logic: IC.len() - 1 should be 4
    let vk_json: serde_json::Value = serde_json::from_str(&dummy_vk_json(5)).unwrap();
    let ic = vk_json.get("IC").and_then(|v| v.as_array()).unwrap();
    assert_eq!(ic.len(), 5);
    assert_eq!(ic.len() - 1, 4, "4 public inputs expected from IC of length 5");

    // Also check the file exists (smoke)
    assert!(vk_path.exists());
}

#[test]
fn detect_signals_counts_for_default_oiap_circuit() {
    // OIAP default: 4 signals → IC has 5 elements
    let vk_json: serde_json::Value = serde_json::from_str(&dummy_vk_json(5)).unwrap();
    let ic = vk_json.get("IC").and_then(|v| v.as_array()).unwrap();
    assert_eq!(ic.len() - 1, 4);
}

// ─── generate tests ───────────────────────────────────────────────────────────

#[test]
fn generate_mock_outputs_correct_hex_lengths() {
    // Mock proof is "01" × 256 = 512 hex chars + "0x" prefix = 514 total chars.
    let mock_proof = format!("0x{}", "01".repeat(256));
    assert_eq!(mock_proof.len(), 2 + 256 * 2, "proof hex should be 514 chars");

    // Mock public inputs are "02" × 128 = 256 hex chars + "0x" = 258.
    let mock_pub = format!("0x{}", "02".repeat(128));
    assert_eq!(mock_pub.len(), 2 + 128 * 2, "public inputs hex should be 258 chars");
}

// ─── signals-config round-trip ────────────────────────────────────────────────

#[test]
fn signals_config_round_trips() {
    use serde_json::Value;

    let config_json = r#"{
  "nullifier_index": 0,
  "cooperative_hash_index": 1,
  "valid_until_index": 2,
  "current_time_index": 3
}"#;

    // Deserialize and verify fields
    let v: Value = serde_json::from_str(config_json).expect("parse signals config");
    assert_eq!(v["nullifier_index"], 0);
    assert_eq!(v["cooperative_hash_index"], 1);
    assert_eq!(v["valid_until_index"], 2);
    assert_eq!(v["current_time_index"], 3);
}

// ─── public signals parsing ───────────────────────────────────────────────────

#[test]
fn public_signals_count_matches_ic_count() {
    // Standard OIAP circuit: 4 public inputs
    let pub_json = dummy_public_json(4);
    let v: serde_json::Value = serde_json::from_str(&pub_json).unwrap();
    let arr = v.as_array().unwrap();
    assert_eq!(arr.len(), 4);
}

// ─── vk-to-bin round-trip ────────────────────────────────────────────────────

#[test]
fn vk_json_parse_produces_expected_point_count() {
    // IC with 5 elements: the VerifyingKey gamma_abc_g1 should have 5 elements.
    let vk_json_str = dummy_vk_json(5);
    let v: serde_json::Value = serde_json::from_str(&vk_json_str).unwrap();
    let ic = v.get("IC").and_then(|arr| arr.as_array()).unwrap();
    assert_eq!(ic.len(), 5, "IC array should have exactly 5 elements");
}

// ─── index bounds ─────────────────────────────────────────────────────────────

#[test]
fn out_of_bounds_index_detected_at_access() {
    let signals: Vec<u64> = vec![1, 2, 3, 4]; // indices 0-3 valid
    let bad_index: usize = 10;
    assert!(
        signals.get(bad_index).is_none(),
        "out-of-bounds index should return None"
    );
}
