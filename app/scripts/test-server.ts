// Own an isolated test surfnet and Next server; do not replace the presenter's session.
import { spawn, type ChildProcess } from "node:child_process";
const env = {
  ...process.env,
  DEMO_RPC_URL: "http://127.0.0.1:18999",
  DEMO_SESSION_FILE: ".demo/e2e/session.json",
};
const children: ChildProcess[] = [];
function start(command: string, args: string[]) {
  const child = spawn(command, args, { env, stdio: "inherit" });
  children.push(child);
  return child;
}
function stop() {
  for (const child of children) child.kill("SIGTERM");
}
process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});
process.on("SIGINT", () => {
  stop();
  process.exit(0);
});
async function main() {
  const surfnet = start("surfpool", [
    "start",
    "--offline",
    "--no-tui",
    "--no-studio",
    "--no-deploy",
    "-y",
    "--airdrop-amount",
    "0",
    "--port",
    "18999",
    "--ws-port",
    "19000",
    "--studio-port",
    "19488",
  ]);
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (surfnet.exitCode !== null) throw new Error("Test surfnet exited");
    try {
      const r = await fetch(env.DEMO_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
        signal: AbortSignal.timeout(500),
      });
      if ((await r.json()).result === "ok") {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw new Error("Test surfnet did not start");
  const seed = start("node", ["--import", "tsx", "scripts/seed.ts"]);
  await new Promise<void>((resolve, reject) => {
    seed.on("error", reject);
    seed.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Test seed failed")),
    );
  });
  const next = start("node", [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3300",
  ]);
  next.on("exit", (code) => {
    stop();
    process.exit(code ?? 1);
  });
}
main().catch((error) => {
  console.error(error);
  stop();
  process.exit(1);
});
