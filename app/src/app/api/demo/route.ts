import { NextRequest, NextResponse } from "next/server";
import {
  act,
  snapshot,
  INVESTORS,
  VERIFIED,
  VALIDITY,
  type InvestorId,
  type IssueOptions,
} from "@/lib/server/demo";
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
const ACTIONS = ["issue", "activate", "allocate"] as const;
/** A UUID, generated per click by the screens. */
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (values as readonly string[]).includes(value);
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
    const { action, investor, options, requestId } = await request.json();
    const verified = options?.verified ?? "today";
    const validity = options?.validity ?? "year";
    if (
      !isOneOf(ACTIONS, action) ||
      !isOneOf(INVESTORS, investor) ||
      !isOneOf(Object.keys(VERIFIED) as IssueOptions["verified"][], verified) ||
      !isOneOf(Object.keys(VALIDITY) as IssueOptions["validity"][], validity) ||
      (requestId !== undefined && !REQUEST_ID.test(String(requestId)))
    )
      return NextResponse.json(
        { error: "Unknown demo action, investor or option." },
        { status: 400 },
      );
    return NextResponse.json(
      await act(action, investor as InvestorId, { verified, validity }, requestId),
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Action failed" },
      { status: 400 },
    );
  }
}
