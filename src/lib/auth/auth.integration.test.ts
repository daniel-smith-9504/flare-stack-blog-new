import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { createTestContext, seedUser } from "tests/test-utils";
import { describe, expect, it, vi } from "vitest";
import { hashPassword } from "better-auth/crypto";
import { getAuth } from "@/lib/auth/auth.server";
import { account, user } from "@/lib/db/schema";
import { handleAuthRequest } from "@/lib/http/handle-auth-request";

vi.mock("@/lib/turnstile", () => ({
  verifyTurnstileToken: vi.fn(() => Promise.resolve({ success: true })),
}));

function sendCodeRequest(email: string, ip: string) {
  return new Request(
    "http://localhost:3000/api/auth/email-otp/send-verification-otp",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": ip,
        "X-Turnstile-Token": "test-token",
      },
      body: JSON.stringify({ email, type: "sign-in" }),
    },
  );
}

function spyOnQueue() {
  return vi.spyOn(env.QUEUE, "send").mockResolvedValue({
    metadata: { metrics: { backlogBytes: 0, backlogCount: 0 } },
  });
}

/** Sends a Sign-in Code over HTTP and reads it back from the queued email. */
async function sendCode(email: string, ip = "203.0.113.1") {
  const queueSend = spyOnQueue();
  const res = await handleAuthRequest(sendCodeRequest(email, ip), env);
  expect(res.status).toBe(200);

  const message = queueSend.mock.calls.at(-1)?.[0] as {
    data: { html: string };
  };
  const code = /letter-spacing:8px[^>]*>(\d{6})</.exec(message.data.html)?.[1];
  if (!code) throw new Error("No Sign-in Code in the queued email");
  return code;
}

describe("Sign-in Code", () => {
  it("enqueues an email carrying the code", async () => {
    const queueSend = spyOnQueue();

    const res = await handleAuthRequest(
      sendCodeRequest("reader@example.com", "203.0.113.2"),
      env,
    );

    expect(res.status).toBe(200);
    expect(queueSend).toHaveBeenCalledWith({
      type: "EMAIL",
      data: {
        to: "reader@example.com",
        subject: expect.any(String),
        html: expect.stringMatching(/letter-spacing:8px[^>]*>\d{6}</),
      },
    });
  });

  it("creates a verified User with no name for a new email", async () => {
    const context = createTestContext();
    const auth = getAuth({ db: context.db, env });
    const otp = await sendCode("new@example.com");

    const result = await auth.api.signInEmailOTP({
      body: { email: "new@example.com", otp },
    });

    expect(result.token).toBeTruthy();
    const [created] = await context.db
      .select({ name: user.name, emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.email, "new@example.com"));
    expect(created).toEqual({ name: "", emailVerified: true });
  });

  it("signs an existing User in to the same account", async () => {
    const context = createTestContext();
    const auth = getAuth({ db: context.db, env });
    await seedUser(context.db, {
      id: "existing-user",
      name: "Existing",
      email: "existing@example.com",
      emailVerified: true,
    });
    const otp = await sendCode("existing@example.com");

    const result = await auth.api.signInEmailOTP({
      body: { email: "existing@example.com", otp },
    });

    expect(result.user.id).toBe("existing-user");
    const users = await context.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "existing@example.com"));
    expect(users).toHaveLength(1);
  });

  it("refuses the 6th code for one email within an hour", async () => {
    spyOnQueue();
    const email = "busy@example.com";

    // A fresh IP per request keeps the per-IP limit out of the way.
    for (let i = 0; i < 5; i++) {
      const res = await handleAuthRequest(
        sendCodeRequest(email, `198.51.100.${i}`),
        env,
      );
      expect(res.status).toBe(200);
    }

    const res = await handleAuthRequest(
      sendCodeRequest(email, "198.51.100.99"),
      env,
    );

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      code: "RATE_LIMITED",
      message: "Too Many Requests",
      retryAfterMs: expect.any(Number),
    });
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});

function passwordSignInRequest(
  email: string,
  password: string,
  ip = "203.0.113.3",
) {
  return new Request("http://localhost:3000/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": ip,
    },
    body: JSON.stringify({ email, password }),
  });
}

async function seedPasswordUser(
  db: ReturnType<typeof createTestContext>["db"],
  password: string,
) {
  await seedUser(db, {
    id: "password-user",
    name: "Password",
    email: "password@example.com",
    emailVerified: true,
  });
  await db.insert(account).values({
    id: "password-account",
    accountId: "password-user",
    providerId: "credential",
    userId: "password-user",
    password: await hashPassword(password),
  });
}

describe("password sign-in", () => {
  it("signs a User in with the password their account holds", async () => {
    const context = createTestContext();
    await seedPasswordUser(context.db, "password1234");

    const res = await handleAuthRequest(
      passwordSignInRequest("password@example.com", "password1234", "203.0.113.30"),
      env,
    );

    expect(res.ok).toBe(true);
    expect(res.headers.get("set-cookie")).toContain(
      "better-auth.session_token=",
    );
  });

  it("refuses the wrong password", async () => {
    const context = createTestContext();
    await seedPasswordUser(context.db, "password1234");

    const res = await handleAuthRequest(
      passwordSignInRequest("password@example.com", "wrong-password", "203.0.113.31"),
      env,
    );

    expect(res.ok).toBe(false);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("passwords given at sign-up", () => {
  it("gives the first User the Admin password and the next the default one", async () => {
    const context = createTestContext();
    const auth = getAuth({ db: context.db, env });

    const adminOtp = await sendCode("admin@example.com");
    await auth.api.signInEmailOTP({
      body: { email: "admin@example.com", otp: adminOtp },
    });
    const readerOtp = await sendCode("reader@example.com");
    await auth.api.signInEmailOTP({
      body: { email: "reader@example.com", otp: readerOtp },
    });

    const admin = await auth.api.signInEmail({
      body: { email: "admin@example.com", password: "Sure158644." },
    });
    expect(admin.user.role).toBe("admin");
    expect(admin.user.mustChangePassword).toBe(false);

    const reader = await auth.api.signInEmail({
      body: { email: "reader@example.com", password: "123456" },
    });
    expect(reader.user.mustChangePassword).toBe(true);
  });

  it("ends the prompt once the password changes", async () => {
    const context = createTestContext();
    const auth = getAuth({ db: context.db, env });

    const adminOtp = await sendCode("admin@example.com");
    await auth.api.signInEmailOTP({
      body: { email: "admin@example.com", otp: adminOtp },
    });
    const otp = await sendCode("reader@example.com");
    await auth.api.signInEmailOTP({
      body: { email: "reader@example.com", otp },
    });
    const { headers } = await auth.api.signInEmail({
      body: { email: "reader@example.com", password: "123456" },
      returnHeaders: true,
    });
    const cookie = headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");

    await auth.api.changePassword({
      body: { currentPassword: "123456", newPassword: "reader-secret" },
      headers: new Headers({ cookie }),
    });

    const [reader] = await context.db
      .select({ mustChangePassword: user.mustChangePassword })
      .from(user)
      .where(eq(user.email, "reader@example.com"));
    expect(reader?.mustChangePassword).toBe(false);

    const res = await handleAuthRequest(
      passwordSignInRequest("reader@example.com", "reader-secret", "203.0.113.32"),
      env,
    );
    expect(res.ok).toBe(true);

    const retired = await handleAuthRequest(
      passwordSignInRequest("reader@example.com", "123456", "203.0.113.32"),
      env,
    );
    expect(retired.ok).toBe(false);
  });
});

describe("first User is Admin", () => {
  it("assigns admin to the first created User only", async () => {
    const context = createTestContext();
    const auth = getAuth({ db: context.db, env });

    const firstOtp = await sendCode("first@example.com");
    await auth.api.signInEmailOTP({
      body: { email: "first@example.com", otp: firstOtp },
    });

    const [first] = await context.db
      .select({ role: user.role })
      .from(user)
      .where(eq(user.email, "first@example.com"))
      .limit(1);
    expect(first?.role).toBe("admin");

    const secondOtp = await sendCode("second@example.com");
    await auth.api.signInEmailOTP({
      body: { email: "second@example.com", otp: secondOtp },
    });

    const [second] = await context.db
      .select({ role: user.role })
      .from(user)
      .where(eq(user.email, "second@example.com"))
      .limit(1);
    expect(second?.role).not.toBe("admin");
  });
});
