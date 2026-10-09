// Pure display helpers shared by the screens. No React or Next imports, so they
// can be unit-tested directly.

export function short(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function formatDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDuration(seconds: number): string {
  const days = Math.round(seconds / 86_400);
  if (days >= 365 && days % 365 === 0) return `${days / 365} year${days === 365 ? "" : "s"}`;
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`;
  return `${Math.round(seconds / 60)} minutes`;
}

/**
 * The fund's KYC age limit for display, or `null` when the policy sets none
 * (`max_age = 0` disables it; expiry still applies).
 */
export function ageLimit(maxAge: number): string | null {
  return maxAge === 0 ? null : formatDuration(maxAge);
}

export const REGION_NAMES: Record<string, string> = {
  DE: "Germany",
  FR: "France",
  US: "United States",
};

export function regionName(code: string): string {
  return REGION_NAMES[code] ?? code;
}

export function regionList(codes: string[]): string {
  const names = codes.map(regionName);
  return names.length <= 1
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
