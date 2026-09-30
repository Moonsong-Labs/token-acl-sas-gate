import { NextRequest, NextResponse } from "next/server";
import { status } from "@/lib/server/demo";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host))
    return NextResponse.json({ error: "This demo is local only." }, { status: 400 });
  try {
    return NextResponse.json(await status(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Status unavailable" },
      { status: 503 },
    );
  }
}
