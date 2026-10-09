// Own an isolated test surfnet and Next server; do not replace the presenter's session.
//
// The app reaches the surfnet through two chained proxies: a history-failure
// proxy (19001) that the UC2 timeline tests drive via /fault, which forwards to
// the fault proxy on FAULT_PORT that the resilience tests drive via /__faults
// (see `faults` below). Tests that read chain state directly still use SURFNET.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
const SURFNET = "http://127.0.0.1:18999";
const FAULT_PORT = 18998;
// Proxies chain: the app → history proxy (19001) → fault proxy (FAULT_PORT) →
// surfnet (SURFNET). So the history proxy forwards to the fault proxy, not the
// surfnet directly.
const upstream = `http://127.0.0.1:${FAULT_PORT}`;
const env = {
  ...process.env,
  DEMO_RPC_URL: "http://127.0.0.1:19001",
  DEMO_SESSION_FILE: ".demo/e2e/session.json",
  // Links point at the test surfnet's Studio port. The suite checks the links,
  // not Studio itself, so Studio stays disabled below.
  DEMO_STUDIO_URL: "http://127.0.0.1:19488",
};
/**
 * Armed by POST /__faults with `{ "rules": [...] }`; an empty list disarms. A
 * rule fails the next `count` calls to `method` with a JSON-RPC error (`code`,
 * default -32000), starting only once a call to `after` has gone through, when
 * set. With `deliver`, the call is forwarded to the surfnet first and the error
 * is returned anyway, like a failure on the way back. Everything else is
 * forwarded unchanged.
 */
type Rule = {
  method: string;
  count: number;
  after?: string;
  code?: number;
  deliver?: boolean;
  hold?: boolean;
  result?: unknown;
  armed?: boolean;
};
let faults: Rule[] = [];
let held: string[] = [];
function startFaultProxy() {
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    if (request.url === "/__release") {
      for (const pending of held) await fetch(SURFNET, { method: "POST", headers: { "Content-Type": "application/json" }, body: pending });
      held = [];
      response.writeHead(204).end();
      return;
    }
    if (request.url === "/__faults") {
      faults = (JSON.parse(body).rules as Rule[]).map((r) => ({ ...r, armed: !r.after }));
      response.writeHead(204).end();
      return;
    }
    const { id, method } = JSON.parse(body) as { id: unknown; method: string };
    const rule = faults.find((r) => r.armed && r.method === method && r.count > 0);
    if (rule) {
      rule.count -= 1;
      if (rule.hold) held.push(body);
      if (rule.deliver)
        await fetch(SURFNET, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          ...(rule.result !== undefined
            ? { result: rule.result }
            : { error: { code: rule.code ?? -32000, message: `Injected fault: ${method}` } }),
        }),
      );
      return;
    }
    for (const r of faults) if (r.after === method) r.armed = true;
    const upstream = await fetch(SURFNET, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    response.writeHead(upstream.status, { "Content-Type": "application/json" });
    response.end(await upstream.text());
  });
  server.listen(FAULT_PORT, "127.0.0.1");
  return server;
}
const children: ChildProcess[] = [];
// Test-only RPC proxy. Fault injection never enters the production API.
let failedMethod: string | null = null;
let failures = 0;
const proxy = createServer(async (request, response) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/fault") {
      if (request.method === "POST") {
        const { method } = JSON.parse(body);
        if (![null, "getTransaction", "getSignaturesForAddress"].includes(method))
          throw new Error("Unsupported fault");
        failedMethod = method;
        failures = 0;
      }
      response.end(JSON.stringify({ method: failedMethod, failures }));
      return;
    }
    const payload = JSON.parse(body);
    if (payload.method === failedMethod) {
      failures += 1;
      response.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id,
        error: { code: -32000, message: "Injected transaction-history failure" } }));
      return;
    }
    const forwarded = await fetch(upstream, {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
      signal: AbortSignal.timeout(15000),
    });
    response.writeHead(forwarded.status);
    response.end(await forwarded.text());
  } catch {
    response.writeHead(502);
    response.end(JSON.stringify({ error: "Test RPC proxy failure" }));
  }
});
function start(command: string, args: string[]) {
  const child = spawn(command, args, { env, stdio: "inherit" });
  children.push(child);
  return child;
}
function stop() {
  for (const child of children) child.kill("SIGTERM");
  proxy.close();
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
  await new Promise<void>((resolve, reject) => {
    proxy.on("error", reject);
    proxy.listen(19001, "127.0.0.1", resolve);
  });
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
      const r = await fetch(SURFNET, {
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
  startFaultProxy();
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
