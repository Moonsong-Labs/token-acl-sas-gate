# Doors of Durin — demo frontend (skeleton)

A minimal web demo for the Token ACL gate, driven against a local
[surfpool](https://surfpool.run) surfnet. This is **wiring only**: it connects to
the surfnet, reports program status, and provides a seed command. The role
screens (per the UI mockups) and the real thaw flow land next.

## Stack

- **Chain:** `surfpool start` — a local surfnet exposing a standard Solana RPC on
  `127.0.0.1:8899`. It forks mainnet accounts/programs on demand (so SAS and
  Token ACL resolve automatically) and offers cheatcodes + clock control.
- **Frontend:** Next.js (App Router, TypeScript) + [`@solana/kit`](https://www.npmjs.com/package/@solana/kit).
- **Seed:** a TypeScript script (`scripts/seed.ts`) that shares the app's client
  and program IDs.

## Prerequisites

The demo toolchain is pinned in `app/mise.toml` — Node and the surfpool **CLI**
at `1.6.0` (matching the workspace's `surfpool-sdk`, so fork/cheatcode/clock
behavior lines up with the Rust tests). From `app/`:

```sh
mise install        # provisions the pinned Node and surfpool CLI
```

(Or use ambient tools if you prefer: Node 20+/npm and a surfpool 1.6.x CLI,
installed per <https://docs.surfpool.run>. The CLI is a separate binary from the
`surfpool-sdk` crate the Rust tests use.)

## Run

Use the `mise run` tasks — they wrap `npm` so it runs under the **pinned** Node.
Invoking `npm`/`node` directly uses whatever is on `PATH` (e.g. `/snap/bin/node`),
not the pinned version. After `mise install` (see Prerequisites):

```sh
# 1. Start the surfnet (separate terminal). Forks mainnet, so SAS + Token ACL
#    resolve on demand; deploy the gate (below) for it to show as executable.
mise run surfnet
#   = surfpool start --no-tui --no-studio --no-deploy -y \
#       --network mainnet --airdrop-amount 0   (verified against surfpool 1.6.0)

# 2. Install web deps, then preflight the surfnet.
mise run deps
mise run seed

# 3. Dev server.
mise run dev        # http://localhost:3000
```

Verified end to end against surfpool 1.6.0: the seed reports SAS and Token ACL as
`executable` (forked from mainnet) and the page serves at `localhost:3000`.

Override the endpoint with `NEXT_PUBLIC_RPC_URL` in `.env.local` (see
`.env.local.example`) — e.g. a hosted surfnet or devnet for a shared demo. Both
the page and `mise run seed` read it from `.env.local`, so they always target the
same surfnet.

## Deploying the gate to the surfnet

The gate (`doors-of-durin`) is built from the parent Rust crate. Build it with the
pinned toolchain and deploy the resulting `.so` to the running surfnet at the
fixed test address in `tests/support/ids.rs`
(`55fu8EtaF3Zsp35cXtWvQvBi9iVeGgCKms6WWbanj1zz`):

```sh
# from the repo root
mise run build      # -> target/deploy/doors_of_durin.so
```

Wiring surfpool to auto-load the pinned `tests/fixtures/programs/*.so` and deploy
the gate on start (via a `Surfpool.toml` or a txtx runbook) is a follow-up — the
exact config schema should be confirmed against the installed surfpool version.

## Layout

- `src/app/page.tsx` — the status screen (RPC health + program deploy status).
- `src/lib/rpc.ts` — the `@solana/kit` client pointed at the surfnet.
- `src/lib/ids.ts` — program IDs (kept in sync with `tests/support/ids.rs`).
- `scripts/seed.ts` — surfnet seed (minimal today; setup steps are TODO).

## Notes

- The **gate program is not implemented yet** (still a no-op placeholder), so the
  demo stubs the allow/deny decision until the UC1 gate lands. `src/lib/ids.ts`
  and `scripts/seed.ts` already point at the right programs so the rest can be
  built now.
- Subject binding is on the attestation `nonce`; the seed must set
  `nonce = investor wallet` when it pre-issues a credential.
