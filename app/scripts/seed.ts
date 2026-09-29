// A fresh local UC1 session. Only funding and program deployment use cheatcodes.
// Fund, policy, status records and token accounts are created by real instructions.
import { randomBytes, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import {
  GATE,
  SAS,
  TOKEN_ACL,
  SYSTEM,
  TOKEN,
  signer,
  pda,
  key,
  str,
  bytes,
  num,
  ro,
  rw,
  signed,
  ix,
  rpc,
  send,
  createAccount,
  addresses,
  endpoint,
} from "../src/lib/server/chain";
import { manifestPath, type Manifest } from "../src/lib/server/demo";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
async function main() {
  await rpc("getHealth");
  const source = await readFile("../tests/support/ids.rs", "utf8");
  for (const [id, file, name] of [
    [SAS, "../tests/fixtures/programs/sas.so", "SAS"],
    [TOKEN_ACL, "../tests/fixtures/programs/token_acl.so", "TOKEN_ACL"],
    [GATE, "../target/deploy/doors_of_durin.so", "GATE"],
  ] as const) {
    const binary = await readFile(file);
    if (name !== "GATE") {
      const hash = source.match(
        new RegExp(
          `pub const ${name}: Program = Program \\{[\\s\\S]*?sha256: "([a-f0-9]+)"`,
        ),
      )?.[1];
      if (!hash || createHash("sha256").update(binary).digest("hex") !== hash)
        throw new Error(`${name} binary does not match the Rust fixture pin.`);
    }
    await rpc("surfnet_writeProgram", [id, binary.toString("hex"), 0]);
  }
  const payerSeed = randomBytes(32).toString("hex");
  const issuerSeed = randomBytes(32).toString("hex");
  const payer = await signer(payerSeed);
  const issuer = await signer(issuerSeed);
  const mint = await signer(randomBytes(32).toString("hex"));
  await rpc("surfnet_setAccount", [payer.address, { lamports: 10000000000 }]);
  const credential = await pda(
    SAS,
    "credential",
    key(issuer.address),
    "uc1-demo",
  );
  const schema = await pda(
    SAS,
    "schema",
    key(credential),
    "eligibility",
    Buffer.from([1]),
  );
  await send(payer, [
    ix(SAS, bytes([0], str("uc1-demo"), num(1, 4), key(issuer.address)), [
      signed(payer, true),
      rw(credential),
      signed(issuer),
      ro(SYSTEM),
    ]),
    ix(
      SAS,
      bytes(
        [1],
        str("eligibility"),
        str("UC1 demo fixture"),
        str(Buffer.from([12, 8])),
        num(2, 4),
        str("jurisdiction"),
        str("verified_at"),
      ),
      [
        signed(payer, true),
        signed(issuer),
        ro(credential),
        rw(schema),
        ro(SYSTEM),
      ],
    ),
  ]);
  // Token-2022 DefaultAccountState mint: 166-byte extension header + 5 bytes.
  await send(payer, [
    createAccount(payer, mint, 171),
    ix(TOKEN, [28, 0, 2], [rw(mint.address)]),
    ix(TOKEN, bytes([20, 6], key(payer.address), [1], key(payer.address)), [
      rw(mint.address),
    ]),
  ]);
  const config = await pda(TOKEN_ACL, "MINT_CONFIG", key(mint.address));
  await send(payer, [
    ix(TOKEN_ACL, bytes([0], key(GATE)), [
      signed(payer, true),
      signed(payer),
      rw(mint.address),
      rw(config),
      ro(SYSTEM),
      ro(TOKEN),
    ]),
    ix(TOKEN_ACL, [8, 0, 1], [signed(payer), rw(config)]),
  ]);
  const policy = Buffer.alloc(91);
  policy[0] = 1;
  key(credential).copy(policy, 1);
  key(schema).copy(policy, 33);
  policy[65] = 1;
  num(86400).copy(policy, 66);
  policy[74] = 2;
  Buffer.from("DEFR").copy(policy, 75);
  await send(payer, [
    ix(GATE, bytes([0], policy), [
      signed(payer, true),
      signed(payer),
      ro(mint.address),
      ro(config),
      rw(await pda(GATE, "policy", key(mint.address))),
      rw(await pda(GATE, "thaw_extra_account_metas", key(mint.address))),
      ro(schema),
      ro(SYSTEM),
    ]),
  ]);
  const investors = {} as Manifest["investors"];
  for (const [id, name, jurisdiction] of [
    ["alice", "Alice", "DE"],
    ["bob", "Bob", "US"],
  ] as const) {
    const wallet = await signer(randomBytes(32).toString("hex"));
    const token = await signer(randomBytes(32).toString("hex"));
    await send(payer, [
      createAccount(payer, token, 170),
      ix(TOKEN, [22], [rw(token.address)]),
      ix(TOKEN, bytes([18], key(wallet.address)), [
        rw(token.address),
        ro(mint.address),
      ]),
    ]);
    const a = await addresses(
      mint.address,
      credential,
      schema,
      wallet.address,
      token.address,
    );
    await send(
      payer,
      [
        [wallet.address, a.walletStatus],
        [token.address, a.tokenStatus],
      ].map(([subject, record]) =>
        ix(
          GATE,
          [1],
          [
            signed(payer, true),
            ro(payer.address),
            ro(mint.address),
            ro(config),
            ro(subject),
            rw(record),
            ro(SYSTEM),
          ],
        ),
      ),
    );
    investors[id] = {
      name,
      jurisdiction,
      wallet: wallet.address,
      token: token.address,
    };
  }
  const manifest: Manifest = {
    rpc: endpoint(),
    payerSeed,
    issuerSeed,
    mint: mint.address,
    credential,
    schema,
    investors,
  };
  await mkdir(dirname(manifestPath()), { recursive: true, mode: 0o700 });
  await writeFile(manifestPath() + ".tmp", JSON.stringify(manifest, null, 2), {
    mode: 0o600,
  });
  await rename(manifestPath() + ".tmp", manifestPath());
  console.log(
    "UC1 ready: one DE/FR fund, Alice (DE), Bob (US), both frozen and without credentials.",
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
