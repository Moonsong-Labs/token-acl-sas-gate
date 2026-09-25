import { address, type Address } from "@solana/kit";

// Program IDs — single source of truth is `tests/support/ids.rs`; keep in sync.
// (A future step can codegen this file from that Rust module.)
export const GATE: Address = address(
  "55fu8EtaF3Zsp35cXtWvQvBi9iVeGgCKms6WWbanj1zz",
);
export const SAS: Address = address(
  "22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG",
);
export const TOKEN_ACL: Address = address(
  "TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP",
);

export const PROGRAMS: ReadonlyArray<{ name: string; id: Address }> = [
  { name: "Gate (doors-of-durin)", id: GATE },
  { name: "Solana Attestation Service", id: SAS },
  { name: "Token ACL", id: TOKEN_ACL },
];
