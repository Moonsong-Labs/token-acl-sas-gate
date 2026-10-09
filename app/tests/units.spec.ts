import { test, expect } from "@playwright/test";
import { locate, steps } from "../src/lib/gate";
import { ageLimit } from "../src/lib/format";

// Pure checks, no browser or chain.

test("codes the gate also raises during the policy phase are not pinned to one step", () => {
  // Malformed (3) comes from input authentication, but also from the token
  // account's extensions after the schema check and from the claim after the
  // expiry check. Context (14) is about how the request arrived, not a credential.
  expect(locate(3)).toBeNull();
  expect(locate(14)).toBeNull();
  const unplaced = steps({ outcome: "unverified", code: 3, name: "Malformed" });
  expect(unplaced.every((s) => s.status === "not_reached")).toBe(true);
  // Codes raised in one place still are.
  expect(locate(2)).toBe("inputs_authentic");
  expect(locate(10)).toBe("fresh");
  expect(locate(13)).toBe("claims_satisfied");
});

test("an age limit of zero means no limit, not zero minutes", () => {
  expect(ageLimit(0)).toBeNull();
  expect(ageLimit(365 * 86_400)).toBe("1 year");
});
