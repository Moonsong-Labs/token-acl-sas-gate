mod support;

use solana_sdk::{
    instruction::Instruction, native_token::LAMPORTS_PER_SOL, signature::Signer,
    transaction::Transaction,
};
use support::{LocalValidator, SAS_PROGRAM_ID};

#[test]
#[ignore = "requires Solana CLI tools; downloads SAS unless SAS_PROGRAM_SO is set"]
fn programs_are_loaded_and_doors_of_durin_executes() {
    let validator = LocalValidator::start();
    let rpc = &validator.rpc;

    for program_id in [validator.doors_of_durin_id, SAS_PROGRAM_ID] {
        let account = rpc.get_account(&program_id).expect("fetch program account");
        assert!(account.executable, "{program_id} must be executable");
    }

    let airdrop = rpc
        .request_airdrop(&validator.payer.pubkey(), LAMPORTS_PER_SOL)
        .expect("request local airdrop");
    validator.confirm(&airdrop);

    let transaction = Transaction::new_signed_with_payer(
        &[Instruction::new_with_bytes(
            validator.doors_of_durin_id,
            &[],
            vec![],
        )],
        Some(&validator.payer.pubkey()),
        &[&validator.payer],
        rpc.get_latest_blockhash().expect("fetch recent blockhash"),
    );
    let signature = rpc
        .send_transaction(&transaction)
        .expect("send instruction");
    validator.confirm(&signature);
}
