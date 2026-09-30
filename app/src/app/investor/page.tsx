import { redirect } from "next/navigation";

/** Bare `/investor` lands on the first investor's account. */
export default function InvestorIndex() {
  redirect("/investor/lena");
}
