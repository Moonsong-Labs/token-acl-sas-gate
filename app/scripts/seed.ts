// Surfnet preflight for the demo: verify the surfnet is reachable and that the
// programs the demo depends on are present. Exits non-zero on failure so an
// unreachable RPC or a missing required program can't be mistaken for a
// completed setup.
//
// The actual seeding (mint, config, policy, keypairs, credential) is a labelled
// TODO below — it lands with the role screens.
//
// Run: `npm run seed` (after `npm run surfnet`).

import { address, createSolanaRpc } from "@solana/kit";

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8899";

// SAS and Token ACL are required — the surfnet forks them from mainnet. The gate
// is optional until it is built and deployed, so its absence is a warning.
const PROGRAMS: ReadonlyArray<{ name: string; id: string; required: boolean }> = [
  {
    name: "Solana Attestation Service",
    id: "22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG",
    required: true,
  },
  {
    name: "Token ACL",
    id: "TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP",
    required: true,
  },
  {
    name: "Gate (doors-of-durin)",
    id: "55fu8EtaF3Zsp35cXtWvQvBi9iVeGgCKms6WWbanj1zz",
    required: false,
  },
];

const rpc = createSolanaRpc(RPC_URL);

async function main(): Promise<void> {
  console.log(`seed: surfnet ${RPC_URL}`);

  // A down RPC must fail loudly, not look like a completed setup.
  try {
    const health = await rpc.getHealth().send();
    console.log(`seed: health = ${health}`);
  } catch (error) {
    console.error(
      `seed: surfnet unreachable at ${RPC_URL} — is \`npm run surfnet\` running?`,
    );
    console.error(error);
    process.exit(1);
  }

  const missing: string[] = [];
  for (const program of PROGRAMS) {
    let executable = false;
    try {
      const { value } = await rpc
        .getAccountInfo(address(program.id), { encoding: "base64" })
        .send();
      executable = value?.executable ?? false;
      const state = executable
        ? "executable"
        : value
          ? "present (not a program)"
          : "absent";
      console.log(
        `seed: ${program.name.padEnd(28)} ${program.id.slice(0, 4)}…${program.id.slice(-4)}  ${state}`,
      );
    } catch (error) {
      console.error(
        `seed: ${program.name} lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (program.required && !executable) {
      missing.push(program.name);
    }
  }

  if (missing.length > 0) {
    console.error(
      `seed: required program(s) unavailable: ${missing.join(", ")}. Start the ` +
        "surfnet with `npm run surfnet` (it forks them from mainnet).",
    );
    process.exit(1);
  }

  // The gate is expected to be absent until it is built and deployed.
  console.log("seed: preflight ok — setup steps are TODO (see below).");

  // TODO — reach a known starting state for the demo (with the role screens):
  //   * create the Token-2022 mint (DefaultAccountState = Frozen)
  //   * Token ACL create-config -> MintConfig; enable permissionless thaw
  //   * initialise the gate extra-metas account; write the per-mint policy
  //   * fund role keypairs (operator / issuer / investor / compliance)
  //   * optionally pre-issue a SAS credential (nonce = investor wallet)
  //
  // Surfnet cheatcodes (surfnet_* JSON-RPC methods) can fabricate these states
  // directly and control the clock for the expiry demo.
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
