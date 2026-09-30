//! Real SAS issuance and Token-2022/ACL setup for UC1.
use super::{Harness, Outcome, ids, sas_ix};
use doors_of_durin::{metas, state::Policy};
use solana_instruction::{AccountMeta as Meta, Instruction};
use spl_token_2022_interface::{
    extension::{
        ExtensionType, default_account_state::instruction::initialize_default_account_state,
    },
    instruction as token,
    state::{Account, AccountState, Mint},
};
use surfpool_sdk::{Keypair, Pubkey, Signer, cheatcodes::builders::SetAccount};
use token_acl_client::{
    accounts::{FlagAccount, MintConfig},
    instructions::*,
};

pub const SYSTEM: Pubkey = Pubkey::from_str_const("11111111111111111111111111111111");
pub const TOKEN: Pubkey = Pubkey::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub fn policy_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"policy", mint.as_ref()], &ids::GATE).0
}
pub fn status_pda(mint: &Pubkey, subject: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"status", mint.as_ref(), subject.as_ref()], &ids::GATE).0
}
pub fn list_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[metas::SEED, mint.as_ref()], &ids::GATE).0
}
pub fn claim(jurisdiction: &str, verified_at: i64) -> Vec<u8> {
    let mut bytes = sas_ix::string_claim(jurisdiction);
    bytes.extend_from_slice(&verified_at.to_le_bytes());
    bytes
}
pub struct Admission {
    pub harness: Harness,
    pub mint: Pubkey,
    pub token: Pubkey,
    pub investor: Keypair,
    /// Aster Identity administers the credential; its desk signs attestations.
    pub credential_authority: Keypair,
    pub issuer: Keypair,
    pub credential: Pubkey,
    pub schema: Pubkey,
    pub evidence: Pubkey,
    pub policy: Policy,
    pub now: i64,
}
impl Admission {
    pub async fn start() -> Self {
        let harness = Harness::start().await;
        let payer = harness.payer().pubkey();
        let credential_authority = Keypair::new();
        let issuer = Keypair::new();
        let investor = Keypair::new();
        let credential = sas_ix::credential_pda(&credential_authority.pubkey(), "Aster Identity");
        let schema = sas_ix::schema_pda(&credential, "investor-jurisdiction");
        harness
            .send(
                &[
                    sas_ix::create_credential(
                        &payer,
                        &credential,
                        &credential_authority.pubkey(),
                        "Aster Identity",
                        &[issuer.pubkey()],
                    ),
                    sas_ix::create_schema(
                        &payer,
                        &credential_authority.pubkey(),
                        &credential,
                        &schema,
                        "investor-jurisdiction",
                        "Aster verified investor jurisdiction",
                        &[12, 8],
                        &["jurisdiction", "verified_at"],
                    ),
                ],
                &[harness.payer(), &credential_authority],
            )
            .assert_success();
        let mint_key = Keypair::new();
        let mint = mint_key.pubkey();
        let len =
            ExtensionType::try_calculate_account_len::<Mint>(&[ExtensionType::DefaultAccountState])
                .unwrap();
        harness
            .send(
                &[
                    solana_system_interface::instruction::create_account(
                        &payer, &mint, 10_000_000, len as u64, &TOKEN,
                    ),
                    initialize_default_account_state(&TOKEN, &mint, &AccountState::Frozen).unwrap(),
                    token::initialize_mint2(&TOKEN, &mint, &payer, Some(&payer), 6).unwrap(),
                ],
                &[harness.payer(), &mint_key],
            )
            .assert_success();
        let config = MintConfig::find_pda(&mint).0;
        harness
            .send(
                &[
                    CreateConfig {
                        payer,
                        authority: payer,
                        mint,
                        mint_config: config,
                        system_program: SYSTEM,
                        token_program: TOKEN,
                    }
                    .instruction(CreateConfigInstructionArgs {
                        gating_program: ids::GATE,
                    }),
                    TogglePermissionlessInstructions {
                        authority: payer,
                        mint_config: config,
                    }
                    .instruction(
                        TogglePermissionlessInstructionsInstructionArgs {
                            freeze_enabled: false,
                            thaw_enabled: true,
                        },
                    ),
                ],
                &[harness.payer()],
            )
            .assert_success();
        let policy = Policy {
            credential,
            schema,
            schema_version: 1,
            max_age: 86400,
            jurisdictions: vec![*b"DE", *b"FR"],
        };
        let evidence = sas_ix::attestation_pda(&credential, &schema, &investor.pubkey());
        let now = crate::on_chain_unix(&harness);
        let mut fixture = Self {
            harness,
            mint,
            token: Pubkey::default(),
            investor,
            credential_authority,
            issuer,
            credential,
            schema,
            evidence,
            policy,
            now,
        };
        // An investor cannot seize the initial policy or discovery list.
        crate::gate_denied(
            &fixture.harness.send(
                &[fixture.configure(&fixture.investor.pubkey(), &fixture.policy)],
                &[fixture.harness.payer(), &fixture.investor],
            ),
            doors_of_durin::GateError::Unauthorized,
        );
        // A lamport donation must not prevent the authority from initializing a PDA.
        fixture
            .harness
            .send(
                &[
                    solana_system_interface::instruction::transfer(
                        &payer,
                        &policy_pda(&mint),
                        1_000_000,
                    ),
                    solana_system_interface::instruction::transfer(
                        &payer,
                        &list_pda(&mint),
                        1_000_000,
                    ),
                ],
                &[fixture.harness.payer()],
            )
            .assert_success();
        fixture
            .harness
            .send(
                &[fixture.configure(&payer, &fixture.policy)],
                &[fixture.harness.payer()],
            )
            .assert_success();
        fixture.token = fixture.new_token(true);
        fixture
            .harness
            .send(
                &[
                    fixture.status(&fixture.investor.pubkey(), None, &payer),
                    fixture.status(&fixture.token, None, &payer),
                ],
                &[fixture.harness.payer()],
            )
            .assert_success();
        fixture.issue("DE", now - 10, now + 86400);
        fixture
    }
    pub fn configure(&self, authority: &Pubkey, policy: &Policy) -> Instruction {
        let mut data = vec![0];
        data.extend_from_slice(&policy.encode().unwrap());
        Instruction::new_with_bytes(
            ids::GATE,
            &data,
            vec![
                Meta::new(self.harness.payer().pubkey(), true),
                Meta::new_readonly(*authority, true),
                Meta::new_readonly(self.mint, false),
                Meta::new_readonly(MintConfig::find_pda(&self.mint).0, false),
                Meta::new(policy_pda(&self.mint), false),
                Meta::new(list_pda(&self.mint), false),
                Meta::new_readonly(policy.schema, false),
                Meta::new_readonly(SYSTEM, false),
            ],
        )
    }
    pub fn status(
        &self,
        subject: &Pubkey,
        flags: Option<[u8; 2]>,
        authority: &Pubkey,
    ) -> Instruction {
        let data = flags
            .map(|f| vec![2, f[0], f[1]])
            .unwrap_or_else(|| vec![1]);
        Instruction::new_with_bytes(
            ids::GATE,
            &data,
            vec![
                Meta::new(self.harness.payer().pubkey(), true),
                Meta::new_readonly(*authority, flags.is_some()),
                Meta::new_readonly(self.mint, false),
                Meta::new_readonly(MintConfig::find_pda(&self.mint).0, false),
                Meta::new_readonly(*subject, false),
                Meta::new(status_pda(&self.mint, subject), false),
                Meta::new_readonly(SYSTEM, false),
            ],
        )
    }
    pub fn new_token(&self, immutable: bool) -> Pubkey {
        let key = Keypair::new();
        let payer = self.harness.payer().pubkey();
        let len = if immutable {
            ExtensionType::try_calculate_account_len::<Account>(&[ExtensionType::ImmutableOwner])
                .unwrap()
        } else {
            165
        };
        let mut ixs = vec![solana_system_interface::instruction::create_account(
            &payer,
            &key.pubkey(),
            10_000_000,
            len as u64,
            &TOKEN,
        )];
        if immutable {
            ixs.push(token::initialize_immutable_owner(&TOKEN, &key.pubkey()).unwrap());
        }
        ixs.push(
            token::initialize_account3(&TOKEN, &key.pubkey(), &self.mint, &self.investor.pubkey())
                .unwrap(),
        );
        self.harness
            .send(&ixs, &[self.harness.payer(), &key])
            .assert_success();
        key.pubkey()
    }
    pub fn issue(&self, jurisdiction: &str, verified_at: i64, expiry: i64) {
        self.harness
            .send(
                &[sas_ix::create_attestation(
                    &self.harness.payer().pubkey(),
                    &self.issuer.pubkey(),
                    &self.credential,
                    &self.schema,
                    &self.evidence,
                    &self.investor.pubkey(),
                    &claim(jurisdiction, verified_at),
                    expiry,
                )],
                &[self.harness.payer(), &self.issuer],
            )
            .assert_success();
    }
    pub fn revoke(&self) {
        self.harness
            .send(
                &[sas_ix::close_attestation(
                    &self.harness.payer().pubkey(),
                    &self.issuer.pubkey(),
                    &self.credential,
                    &self.evidence,
                )],
                &[self.harness.payer(), &self.issuer],
            )
            .assert_success();
    }
    pub fn thaw(&self, caller: Pubkey) -> Instruction {
        ThawPermissionless {
            authority: caller,
            mint: self.mint,
            token_account: self.token,
            flag_account: FlagAccount::find_pda(&self.token).0,
            token_account_owner: self.investor.pubkey(),
            mint_config: MintConfig::find_pda(&self.mint).0,
            token_program: TOKEN,
            system_program: SYSTEM,
            gating_program: ids::GATE,
        }
        .instruction_with_remaining_accounts(&[
            Meta::new_readonly(list_pda(&self.mint), false),
            Meta::new_readonly(policy_pda(&self.mint), false),
            Meta::new_readonly(self.schema, false),
            Meta::new_readonly(ids::SAS.id, false),
            Meta::new_readonly(self.evidence, false),
            Meta::new_readonly(status_pda(&self.mint, &self.investor.pubkey()), false),
            Meta::new_readonly(status_pda(&self.mint, &self.token), false),
        ])
    }
    pub fn send_thaw(&self) -> Outcome {
        self.harness.send(
            &[self.thaw(self.harness.payer().pubkey())],
            &[self.harness.payer()],
        )
    }
    pub fn freeze(&self) {
        self.harness
            .send(
                &[Freeze {
                    authority: self.harness.payer().pubkey(),
                    mint: self.mint,
                    token_account: self.token,
                    mint_config: MintConfig::find_pda(&self.mint).0,
                    token_program: TOKEN,
                }
                .instruction()],
                &[self.harness.payer()],
            )
            .assert_success();
    }
    pub fn token_state(&self) -> u8 {
        self.harness.rpc().get_account(&self.token).unwrap().data[108]
    }
    pub fn replace(&self, address: Pubkey, owner: Pubkey, data: Vec<u8>) {
        self.harness
            .cheats()
            .execute(
                SetAccount::new(address)
                    .owner(owner)
                    .data(data)
                    .lamports(10_000_000),
            )
            .unwrap();
    }
}
