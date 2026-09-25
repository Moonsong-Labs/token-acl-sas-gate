import { createSolanaRpc } from "@solana/kit";

// The demo talks to a local surfnet (`surfpool start`). Override per environment
// with NEXT_PUBLIC_RPC_URL (e.g. a hosted surfnet or devnet).
export const RPC_URL: string =
  process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8899";

export const rpc = createSolanaRpc(RPC_URL);
