//! Shared surfnet harness for the integration suite.

pub mod ids;
pub mod net;
pub mod sas;
pub mod sas_ix;
pub mod sbf;

pub use net::{Harness, Outcome};

pub mod admission;
