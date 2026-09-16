use pinocchio::{AccountView, Address, ProgramResult};

#[cfg(not(feature = "no-entrypoint"))]
pinocchio::entrypoint!(process_instruction);

/// Placeholder processor: accepts any instruction without modifying accounts.
pub fn process_instruction(
    _program_id: &Address,
    _accounts: &mut [AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_program_accepts_instructions() {
        let program_id = Address::new_from_array([0; 32]);

        assert_eq!(process_instruction(&program_id, &mut [], &[]), Ok(()));
        assert_eq!(
            process_instruction(&program_id, &mut [], &[1, 2, 3]),
            Ok(())
        );
    }
}
