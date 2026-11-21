import { env } from "cloudflare:workers";
import { createTestContext, seedUser } from "tests/test-utils";
import { describe, expect, it } from "vitest";
import { hashPassword } from "better-auth/crypto";
import { getAuth } from "@/lib/auth/auth.server";
import { account } from "@/lib/db/schema";
import { handleAuthRequest } from "@/lib/http/handle-auth-request";

async function seed(db: ReturnType<typeof createTestContext>["db"], email: string) {
  await seedUser(db, { id: email, name: email, email, emailVerified: true });
  await db.insert(account).values({
    id: `acc-${email}`,
    accountId: email,
    providerId: "credential",
    userId: email,
    password: await hashPassword("right-password"),
  });
}

function req(email: string, password: string, ip: string) {
  return new Request("http://localhost:3000/api/auth/sign-in/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify({ email, password }),
  });
}

describe("probe", () => {
  it("handler 401", async () => {
    const context = createTestContext();
    await seed(context.db, "a@example.com");
    const auth = getAuth({ db: context.db, env });
    const res = await auth.handler(req("a@example.com", "nope", "198.18.0.1"));
    expect(res.ok).toBe(false);
  });

  it("http 401", async () => {
    const context = createTestContext();
    await seed(context.db, "b@example.com");
    const res = await handleAuthRequest(req("b@example.com", "nope", "198.18.0.2"), env);
    expect(res.ok).toBe(false);
  });

  it("otp 401", async () => {
    const context = createTestContext();
    await seed(context.db, "c@example.com");
    const auth = getAuth({ db: context.db, env });
    const res = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-in/email-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json", "cf-connecting-ip": "198.18.0.3" },
        body: JSON.stringify({ email: "c@example.com", otp: "000000" }),
      }),
    );
    expect(res.ok).toBe(false);
  });
});
