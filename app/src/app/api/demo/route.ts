import { NextRequest, NextResponse } from "next/server";
import { act, snapshot } from "@/lib/server/demo";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function local(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host))
    throw new Error("This demo is local only.");
  const origin = request.headers.get("origin");
  if (request.method === "POST" && origin !== `http://${host}`)
    throw new Error("Use the local demo page to submit actions.");
}
export async function GET(request: NextRequest) {
  try {
    local(request);
    return NextResponse.json(await snapshot(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Demo unavailable" },
      { status: 503 },
    );
  }
}
export async function POST(request: NextRequest) {
  try {
    local(request);
    const { action, investor } = await request.json();
    if (
      !["issue", "activate"].includes(action) ||
      !["alice", "bob"].includes(investor)
    )
      return NextResponse.json(
        { error: "Unknown demo action or investor." },
        { status: 400 },
      );
    return NextResponse.json(await act(action, investor));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Action failed" },
      { status: 400 },
    );
  }
}
