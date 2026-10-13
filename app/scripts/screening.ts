// Simulated screening feed (screening blocks). A CLI fixture that calls the gate's authorized
// status instruction and Token ACL freeze, signed by the fund operator, the
// authority recorded in the mint's Token ACL config. It is not an adapter service.
//
//   npm run screen -- hit    <lena|mark>  sanctions hit: block the wallet and freeze the
//                                         supplied token account in one transaction
//   npm run screen -- delist <lena|mark>  removed from the list: writes nothing, a review is due
//   npm run screen -- lift   <lena|mark>  review outcome: lift the block
//
// A hit and a delisting are separate events: only an authorized lift clears a block.
// Every write reads the wallet's invalidation flag and writes it back unchanged.
// Do not run it during a website action; the two writers are not serialized.
import { existsSync } from "node:fs";
import {
  RpcFailure,
  account,
  addresses,
  freezeIx,
  send,
  setStatusIx,
  signer,
  transactionLink,
} from "../src/lib/server/chain";
import { decodeStatus, decodeTokenAccount } from "../src/lib/server/accounts";
import { INVESTORS, manifest, type InvestorId } from "../src/lib/server/demo";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const EVENTS = ["hit", "delist", "lift"] as const;
type Event = (typeof EVENTS)[number];
const USAGE = `Usage: npm run screen -- <${EVENTS.join("|")}> <${INVESTORS.join("|")}>`;

async function main() {
  const [event, who] = process.argv.slice(2);
  if (
    process.argv.length !== 4 ||
    !EVENTS.includes(event as Event) ||
    !INVESTORS.includes(who as InvestorId)
  ) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const m = await manifest();
  const investor = m.investors[who as InvestorId];
  const mint = m.fund.mint;
  const payer = await signer(m.payerSeed);
  const a = await addresses(
    mint,
    m.credential,
    m.schema,
    investor.wallet,
    investor.token,
  );

  const { blocked, invalidated } = decodeStatus(await account(a.walletStatus));
  const active = decodeTokenAccount(await account(investor.token)).active;

  const setStatus = (block: boolean) =>
    setStatusIx(payer, mint, investor.wallet, block, invalidated);
  const state = () =>
    `${investor.name}: wallet block ${blocked ? "on" : "off"}, invalidation ${invalidated ? "on" : "off"}, account ${active ? "active" : "frozen"}.`;

  if (event === "delist") {
    console.log(state());
    console.log(
      blocked
        ? "Delisting received: a review is due. The block stays until an authorized reviewer runs lift."
        : "Delisting received. The wallet has no block, so nothing changes.",
    );
    return;
  }

  // The status write goes first: an unauthorized signer fails before anything freezes.
  const instructions =
    event === "hit"
      ? [
          ...(blocked ? [] : [await setStatus(true)]),
          ...(active ? [await freezeIx(payer, mint, investor.token)] : []),
        ]
      : blocked
        ? [await setStatus(false)]
        : [];
  if (!instructions.length) {
    console.log(state());
    console.log(
      event === "hit"
        ? "Already blocked and frozen; nothing sent."
        : "No block to lift.",
    );
    return;
  }
  const signature = await send(payer, instructions);
  console.log(
    event === "hit"
      ? `Sanctions hit: ${investor.name}'s wallet is blocked${active ? " and the supplied token account is frozen" : ""}.`
      : active
        ? "Block lifted. The account was not frozen, so it stays active."
        : "Block lifted. The account stays frozen until the investor requests access again.",
  );
  console.log(`Signature ${signature}`);
  const link = transactionLink(signature);
  if (link) console.log(link);
}
main().catch((e) => {
  if (e instanceof RpcFailure) {
    console.error(e.message);
    for (const line of e.details.logs ?? []) console.error(line);
  } else {
    // A message, not a stack trace: e.g. a confirmation timeout. Re-running is
    // safe, since the feed reads chain state first and sends only what is needed.
    console.error(e instanceof Error ? e.message : e);
  }
  process.exitCode = 1;
});
