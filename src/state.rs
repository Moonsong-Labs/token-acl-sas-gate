//! Versioned policy and evidence encodings. All integers are little-endian.
use crate::{GateError, SAS};
use pinocchio::{Address, error::ProgramError};

pub const POLICY_LEN: usize = 91;
pub const STATUS_LEN: usize = 3;

#[derive(Clone, Debug, PartialEq)]
pub struct Policy {
    pub credential: Address,
    pub schema: Address,
    pub schema_version: u8,
    /// Zero disables the additional age limit. Expiry is always enforced.
    pub max_age: i64,
    pub jurisdictions: Vec<[u8; 2]>,
}
impl Policy {
    pub fn decode(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() != POLICY_LEN || data[0] != 1 || !(1..=8).contains(&data[74]) {
            return Err(GateError::Malformed.into());
        }
        let count = data[74] as usize;
        let result = Self {
            credential: address(data, 1)?,
            schema: address(data, 33)?,
            schema_version: data[65],
            max_age: i64::from_le_bytes(array(data, 66)?),
            jurisdictions: data[75..75 + count * 2]
                .chunks_exact(2)
                .map(|x| [x[0], x[1]])
                .collect(),
        };
        if result.schema_version == 0
            || result.max_age < 0
            || result
                .jurisdictions
                .iter()
                .flatten()
                .any(|b| !b.is_ascii_uppercase())
            || data[75 + count * 2..].iter().any(|b| *b != 0)
        {
            return Err(GateError::Malformed.into());
        }
        Ok(result)
    }
    pub fn encode(&self) -> Result<Vec<u8>, ProgramError> {
        if !(1..=8).contains(&self.jurisdictions.len()) {
            return Err(GateError::Malformed.into());
        }
        let mut data = vec![0; POLICY_LEN];
        data[0] = 1;
        data[1..33].copy_from_slice(self.credential.as_ref());
        data[33..65].copy_from_slice(self.schema.as_ref());
        data[65] = self.schema_version;
        data[66..74].copy_from_slice(&self.max_age.to_le_bytes());
        data[74] = self.jurisdictions.len() as u8;
        for (chunk, value) in data[75..].chunks_exact_mut(2).zip(&self.jurisdictions) {
            chunk.copy_from_slice(value);
        }
        Self::decode(&data)?;
        Ok(data)
    }
}

#[derive(Debug, PartialEq)]
pub struct Attestation<'a> {
    pub nonce: Address,
    pub credential: Address,
    pub schema: Address,
    pub data: &'a [u8],
    pub signer: Address,
    pub expiry: i64,
    /// Recipient of the tokenized attestation, unrelated to the regulated token account.
    pub token_account: Address,
}
impl<'a> Attestation<'a> {
    pub fn decode(owner: &Address, data: &'a [u8]) -> Result<Self, ProgramError> {
        if owner != &SAS {
            return Err(GateError::Owner.into());
        }
        if data.len() < 173 || data[0] != 2 {
            return Err(GateError::Malformed.into());
        }
        let len = u32::from_le_bytes(array(data, 97)?) as usize;
        if 173usize.checked_add(len) != Some(data.len()) {
            return Err(GateError::Malformed.into());
        }
        Ok(Self {
            nonce: address(data, 1)?,
            credential: address(data, 33)?,
            schema: address(data, 65)?,
            data: &data[101..101 + len],
            signer: address(data, 101 + len)?,
            expiry: i64::from_le_bytes(array(data, 133 + len)?),
            token_account: address(data, 141 + len)?,
        })
    }
}

pub fn time_valid(expiry: i64, now: i64) -> bool {
    expiry == 0 || now < expiry
}

/// Schema v1 of this adapter: jurisdiction String, verified_at i64.
/// The policy pins the SAS schema address AND its SAS version.
pub struct Schema {
    pub credential: Address,
    pub version: u8,
    pub supported_layout: bool,
}
pub fn decode_schema(data: &[u8], key: &Address) -> Result<Schema, ProgramError> {
    if data.first() != Some(&1) {
        return Err(GateError::Malformed.into());
    }
    let credential = address(data, 1)?;
    let mut offset = 33;
    let name = field(data, &mut offset)?;
    let _description = field(data, &mut offset)?;
    let layout = field(data, &mut offset)?;
    let names = field(data, &mut offset)?;
    let suffix = data.get(offset..).ok_or(GateError::Malformed)?;
    if suffix.len() != 2 || suffix[0] > 1 || name.len() > 32 {
        return Err(GateError::Malformed.into());
    }
    let expected =
        Address::find_program_address(&[b"schema", credential.as_ref(), name, &[suffix[1]]], &SAS)
            .0;
    if key != &expected {
        return Err(GateError::Address.into());
    }
    let mut names_offset = 0;
    let mut fields = Vec::new();
    for _ in layout {
        fields.push(field(names, &mut names_offset)?);
    }
    if names_offset != names.len() {
        return Err(GateError::Malformed.into());
    }
    Ok(Schema {
        credential,
        version: suffix[1],
        supported_layout: layout == [12, 8]
            && fields == [b"jurisdiction".as_slice(), b"verified_at".as_slice()],
    })
}
impl Schema {
    pub fn validate(&self, key: &Address, policy: &Policy) -> Result<(), ProgramError> {
        if !self.supported_layout
            || key != &policy.schema
            || self.version != policy.schema_version
            || self.credential != policy.credential
        {
            return Err(GateError::Schema.into());
        }
        Ok(())
    }
}

pub struct Claim<'a> {
    pub jurisdiction: &'a [u8],
    pub verified_at: i64,
}
impl<'a> Claim<'a> {
    pub fn decode(data: &'a [u8]) -> Result<Self, ProgramError> {
        let mut offset = 0;
        let jurisdiction = field(data, &mut offset)?;
        let verified_at = i64::from_le_bytes(array(data, offset)?);
        if data.len() != offset + 8 || jurisdiction.len() != 2 {
            return Err(GateError::Malformed.into());
        }
        Ok(Self {
            jurisdiction,
            verified_at,
        })
    }
    pub fn validate_age(&self, max_age: i64, now: i64) -> Result<(), ProgramError> {
        if self.verified_at < 0
            || self.verified_at > now
            || (max_age != 0
                && now
                    .checked_sub(self.verified_at)
                    .ok_or(GateError::Freshness)?
                    >= max_age)
        {
            return Err(GateError::Freshness.into());
        }
        Ok(())
    }
    pub fn validate_values(&self, policy: &Policy) -> Result<(), ProgramError> {
        if !policy
            .jurisdictions
            .iter()
            .any(|value| value.as_slice() == self.jurisdiction)
        {
            return Err(GateError::Claim.into());
        }
        Ok(())
    }
}
pub fn array<const N: usize>(data: &[u8], offset: usize) -> Result<[u8; N], ProgramError> {
    data.get(offset..offset.checked_add(N).ok_or(GateError::Malformed)?)
        .and_then(|s| s.try_into().ok())
        .ok_or_else(|| GateError::Malformed.into())
}
pub fn address(data: &[u8], offset: usize) -> Result<Address, ProgramError> {
    Ok(Address::new_from_array(array(data, offset)?))
}
fn field<'a>(data: &'a [u8], offset: &mut usize) -> Result<&'a [u8], ProgramError> {
    let len = u32::from_le_bytes(array(data, *offset)?) as usize;
    *offset = offset.checked_add(4).ok_or(GateError::Malformed)?;
    let end = offset.checked_add(len).ok_or(GateError::Malformed)?;
    let value = data.get(*offset..end).ok_or(GateError::Malformed)?;
    *offset = end;
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn policy() -> Policy {
        Policy {
            credential: Address::new_from_array([3; 32]),
            schema: Address::new_from_array([4; 32]),
            schema_version: 1,
            max_age: 10,
            jurisdictions: vec![*b"DE", *b"FR"],
        }
    }
    #[test]
    fn policy_encoding_rejects_invalid_sets_and_lengths() {
        let p = policy();
        let bytes = p.encode().unwrap();
        assert_eq!(Policy::decode(&bytes).unwrap(), p);
        for len in 0..bytes.len() {
            assert!(Policy::decode(&bytes[..len]).is_err());
        }
        for index in [0, 65, 74] {
            let mut bad = bytes.clone();
            bad[index] = 0;
            assert!(Policy::decode(&bad).is_err());
        }
        let mut p = p;
        p.max_age = -1;
        assert!(p.encode().is_err());
        p.max_age = 0;
        p.jurisdictions = vec![];
        assert!(p.encode().is_err());
        p.jurisdictions = vec![*b"DE"; 9];
        assert!(p.encode().is_err());
        p.jurisdictions = vec![*b"de"];
        assert!(p.encode().is_err());
    }
    #[test]
    fn expiry_and_freshness_boundaries_are_strict() {
        assert!(time_valid(0, i64::MAX));
        assert!(time_valid(100, 99));
        assert!(!time_valid(100, 100));
        assert!(!time_valid(100, 101));
        let claim = Claim {
            jurisdiction: b"DE",
            verified_at: 90,
        };
        assert!(claim.validate_age(10, 99).is_ok());
        assert_eq!(
            claim.validate_age(10, 100),
            Err(GateError::Freshness.into())
        );
        assert!(claim.validate_age(0, 10000).is_ok());
        assert_eq!(claim.validate_age(0, 89), Err(GateError::Freshness.into()));
        assert!(claim.validate_values(&policy()).is_ok());
        assert_eq!(
            Claim {
                jurisdiction: b"US",
                verified_at: 90
            }
            .validate_values(&policy()),
            Err(GateError::Claim.into())
        );
    }
    #[test]
    fn evidence_and_claim_decoders_reject_all_truncations() {
        let mut claim = vec![2, 0, 0, 0, b'D', b'E'];
        claim.extend_from_slice(&90i64.to_le_bytes());
        let mut evidence = vec![2];
        evidence.extend_from_slice(&[1; 32]);
        evidence.extend_from_slice(&[3; 32]);
        evidence.extend_from_slice(&[4; 32]);
        evidence.extend_from_slice(&(claim.len() as u32).to_le_bytes());
        evidence.extend_from_slice(&claim);
        evidence.extend_from_slice(&[5; 32]);
        evidence.extend_from_slice(&100i64.to_le_bytes());
        evidence.extend_from_slice(&[0; 32]);
        let decoded = Attestation::decode(&SAS, &evidence).unwrap();
        assert_eq!(decoded.data, claim);
        assert_eq!(decoded.expiry, 100);
        for len in 0..evidence.len() {
            assert!(Attestation::decode(&SAS, &evidence[..len]).is_err());
        }
        for len in 0..claim.len() {
            assert!(Claim::decode(&claim[..len]).is_err());
        }
        assert!(Attestation::decode(&Address::default(), &evidence).is_err());
        evidence.push(0);
        assert!(Attestation::decode(&SAS, &evidence).is_err());
        evidence.pop();
        evidence[97..101].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(Attestation::decode(&SAS, &evidence).is_err());
        claim.push(0);
        assert!(Claim::decode(&claim).is_err());
    }
}
