//! Minimal SAS attestation decoder for the spike.
//!
//! SAS packs on-chain accounts as manual little-endian bytes with a 1-byte
//! discriminator (not Borsh, not zero-copy). See `docs/SAS_SPIKE.md` §2/§4.
//! This module replicates exactly the two authenticity checks the future gate
//! must perform, plus the field parse, so the probe can cross-check its output
//! against the first-party `Attestation::from_bytes` decoder.
//!
//! Attestation byte map (total `173 + L`, all integers little-endian):
//! ```text
//!   0        1  disc            u8   == 2
//!   1       32  nonce           Pubkey
//!  33       32  credential      Pubkey
//!  65       32  schema          Pubkey
//!  97        4  data_len (= L)  u32
//! 101        L  data            bytes
//! 101+L     32  signer          Pubkey
//! 133+L      8  expiry          i64   Unix seconds; 0 = never
//! 141+L     32  token_account   Pubkey
//! ```

use super::ids;
use surfpool_sdk::Pubkey;

/// Attestation discriminator byte (`Credential = 0`, `Schema = 1`,
/// `Attestation = 2`).
const ATTESTATION_DISCRIMINATOR: u8 = 2;

/// Byte length of an attestation with an empty `data` field; the smallest a
/// genuine attestation account can be.
const MIN_LEN: usize = 173;

/// The attestation fields the gate cares about, decoded from raw account bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedAttestation {
    pub nonce: Pubkey,
    pub credential: Pubkey,
    pub schema: Pubkey,
    pub data: Vec<u8>,
    pub signer: Pubkey,
    pub expiry: i64,
    pub token_account: Pubkey,
}

/// Authenticate and decode an SAS attestation from raw account bytes.
///
/// Authenticity rests on two facts (only the SAS program can own accounts it
/// created via PDA): the account owner is the SAS program, and the first byte
/// is the attestation discriminator. Length is validated against the encoded
/// `data_len` so every field read stays in bounds.
pub fn authenticate_and_decode(
    owner: &Pubkey,
    account_data: &[u8],
) -> Result<DecodedAttestation, &'static str> {
    if owner != &ids::SAS.id {
        return Err("owner is not the SAS program");
    }
    if account_data.len() < MIN_LEN {
        return Err("account data too short for an attestation");
    }
    if account_data[0] != ATTESTATION_DISCRIMINATOR {
        return Err("discriminator is not an attestation");
    }

    let data_len = u32::from_le_bytes(read_array::<4>(account_data, 97)) as usize;
    let total = MIN_LEN
        .checked_add(data_len)
        .ok_or("data_len overflows account size")?;
    if account_data.len() != total {
        // Exactly 173 + data_len — reject a short buffer and also a longer one,
        // so trailing bytes are never reinterpreted as a different layout (this
        // decoder is slated to become the gate's).
        return Err("account data length does not match encoded data_len");
    }

    let nonce = Pubkey::new_from_array(read_array::<32>(account_data, 1));
    let credential = Pubkey::new_from_array(read_array::<32>(account_data, 33));
    let schema = Pubkey::new_from_array(read_array::<32>(account_data, 65));
    let data = account_data[101..101 + data_len].to_vec();
    let signer = Pubkey::new_from_array(read_array::<32>(account_data, 101 + data_len));
    let expiry = i64::from_le_bytes(read_array::<8>(account_data, 133 + data_len));
    let token_account = Pubkey::new_from_array(read_array::<32>(account_data, 141 + data_len));

    Ok(DecodedAttestation {
        nonce,
        credential,
        schema,
        data,
        signer,
        expiry,
        token_account,
    })
}

/// Our read-time validity rule. SAS only checks expiry at creation, so the gate
/// must enforce it: `0` means never expires, otherwise the current time must be
/// strictly before expiry (matching `now == expiry` = expired).
pub fn is_time_valid(expiry: i64, now_unix: i64) -> bool {
    expiry == 0 || now_unix < expiry
}

/// Copy a fixed-size array out of `bytes` starting at `offset`. Callers must
/// have bounds-checked `offset + N`.
fn read_array<const N: usize>(bytes: &[u8], offset: usize) -> [u8; N] {
    let mut out = [0u8; N];
    out.copy_from_slice(&bytes[offset..offset + N]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a synthetic attestation exactly per the byte map, so the decoder
    /// is tested against a layout we hand-assembled rather than SAS itself.
    fn synthetic(
        nonce: Pubkey,
        credential: Pubkey,
        schema: Pubkey,
        data: &[u8],
        signer: Pubkey,
        expiry: i64,
        token_account: Pubkey,
    ) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(MIN_LEN + data.len());
        bytes.push(ATTESTATION_DISCRIMINATOR);
        bytes.extend_from_slice(nonce.as_ref());
        bytes.extend_from_slice(credential.as_ref());
        bytes.extend_from_slice(schema.as_ref());
        bytes.extend_from_slice(&(data.len() as u32).to_le_bytes());
        bytes.extend_from_slice(data);
        bytes.extend_from_slice(signer.as_ref());
        bytes.extend_from_slice(&expiry.to_le_bytes());
        bytes.extend_from_slice(token_account.as_ref());
        bytes
    }

    fn sample() -> (DecodedAttestation, Vec<u8>) {
        let decoded = DecodedAttestation {
            nonce: Pubkey::new_from_array([1u8; 32]),
            credential: Pubkey::new_from_array([2u8; 32]),
            schema: Pubkey::new_from_array([3u8; 32]),
            data: vec![9, 8, 7, 6, 5],
            signer: Pubkey::new_from_array([4u8; 32]),
            expiry: 1_700_000_000,
            token_account: Pubkey::new_from_array([5u8; 32]),
        };
        let bytes = synthetic(
            decoded.nonce,
            decoded.credential,
            decoded.schema,
            &decoded.data,
            decoded.signer,
            decoded.expiry,
            decoded.token_account,
        );
        (decoded, bytes)
    }

    #[test]
    fn every_field_round_trips() {
        let (expected, bytes) = sample();
        assert_eq!(bytes.len(), MIN_LEN + expected.data.len());
        let decoded = authenticate_and_decode(&ids::SAS.id, &bytes)
            .expect("well-formed attestation must decode");
        assert_eq!(decoded, expected);
    }

    #[test]
    fn empty_data_round_trips() {
        let nonce = Pubkey::new_from_array([7u8; 32]);
        let token_account = Pubkey::default();
        let bytes = synthetic(
            nonce,
            Pubkey::new_from_array([2u8; 32]),
            Pubkey::new_from_array([3u8; 32]),
            &[],
            Pubkey::new_from_array([4u8; 32]),
            0,
            token_account,
        );
        assert_eq!(bytes.len(), MIN_LEN);
        let decoded = authenticate_and_decode(&ids::SAS.id, &bytes)
            .expect("empty-data attestation must decode");
        assert!(decoded.data.is_empty());
        assert_eq!(decoded.nonce, nonce);
        assert_eq!(decoded.expiry, 0);
        assert_eq!(decoded.token_account, token_account);
    }

    #[test]
    fn rejects_wrong_owner() {
        let (_, bytes) = sample();
        let not_sas = Pubkey::new_from_array([42u8; 32]);
        assert_eq!(
            authenticate_and_decode(&not_sas, &bytes),
            Err("owner is not the SAS program"),
        );
    }

    #[test]
    fn rejects_wrong_discriminator() {
        let (_, mut bytes) = sample();
        bytes[0] = 1; // Schema discriminator, not Attestation.
        assert_eq!(
            authenticate_and_decode(&ids::SAS.id, &bytes),
            Err("discriminator is not an attestation"),
        );
    }

    #[test]
    fn rejects_too_short() {
        let (_, bytes) = sample();
        let truncated = &bytes[..MIN_LEN - 1];
        assert_eq!(
            authenticate_and_decode(&ids::SAS.id, truncated),
            Err("account data too short for an attestation"),
        );
    }

    #[test]
    fn rejects_data_len_past_end() {
        // A data_len larger than the bytes present must be refused, not read
        // out of bounds.
        let (_, mut bytes) = sample();
        bytes[97..101].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(
            authenticate_and_decode(&ids::SAS.id, &bytes),
            Err("account data length does not match encoded data_len"),
        );
    }

    #[test]
    fn rejects_trailing_byte() {
        // The layout is exactly 173 + data_len; a longer buffer must be refused,
        // not silently reinterpreted.
        let (_, mut bytes) = sample();
        bytes.push(0);
        assert_eq!(
            authenticate_and_decode(&ids::SAS.id, &bytes),
            Err("account data length does not match encoded data_len"),
        );
    }

    #[test]
    fn time_validity_boundaries() {
        // Never-expires sentinel.
        assert!(is_time_valid(0, 1_700_000_000));
        // Strictly before expiry: valid.
        assert!(is_time_valid(1_000, 999));
        // Exactly at expiry: expired.
        assert!(!is_time_valid(1_000, 1_000));
        // Past expiry: expired.
        assert!(!is_time_valid(1_000, 1_001));
    }
}
