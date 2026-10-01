import { notFound } from "next/navigation";
import { INVESTORS, type InvestorId } from "@/lib/server/demo";
import { InvestorScreen } from "./InvestorScreen";

/** One route per investor, so every account has a shareable URL. */
export function generateStaticParams() {
  return INVESTORS.map((who) => ({ who }));
}

export default async function InvestorPage({
  params,
}: {
  params: Promise<{ who: string }>;
}) {
  const { who } = await params;
  if (!(INVESTORS as readonly string[]).includes(who)) notFound();
  return <InvestorScreen who={who as InvestorId} />;
}
