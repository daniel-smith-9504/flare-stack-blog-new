import { createAuthMiddleware } from "@better-auth/core/api";
import { APIError } from "@better-auth/core/error";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getSessionFromCtx } from "better-auth/api";
import { hashPassword } from "better-auth/crypto";
import { betterAuth } from "better-auth/minimal";
import { emailOTP } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveSiteConfig } from "@/features/config/config.resolve";
import * as ConfigRepo from "@/features/config/data/config.data";
import { AuthEmail } from "@/features/email/templates/AuthEmail";
import {
  emailSiteOf,
  type EmailSite,
} from "@/features/email/templates/email-theme";
import {
  inspectApiKeyManagementAccess,
  isApiKeyManagementPath,
  sendsApiKey,
} from "@/lib/auth/api-key-guard";
import { createAuthConfig } from "@/lib/auth/auth.config";
import { getRateLimiter } from "@/lib/do/rate-limiter-binding";
import * as authSchema from "@/lib/db/schema/auth.table";
import { serverEnv } from "@/lib/env/server.env";
import { m } from "@/paraglide/messages";

async function checkEmailRateLimit(
  scope: string,
  email: string,
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const identifier = `${scope}:${email.toLowerCase().trim()}`;
  const rateLimiter = await getRateLimiter(identifier);
  const { allowed, retryAfterMs } = await rateLimiter.checkLimit({
    capacity: 5,
    interval: "1h",
  });
  return { allowed, retryAfterMs };
}

// Signing up, resetting a forgotten password and verifying an address stay
// off (ADR 0040): every User gets a password from the server, so there is
// nothing to sign up for and no address to prove. The OTP flows other than
// sign-in are off too.
const DISABLED_AUTH_PATHS = [
  "/sign-up/email",
  "/request-password-reset",
  "/reset-password",
  "/send-verification-email",
  "/verify-email",
  "/email-otp/check-verification-otp",
  "/email-otp/verify-email",
  "/email-otp/request-password-reset",
  "/email-otp/reset-password",
  "/forget-password/email-otp",
  "/email-otp/request-email-change",
  "/email-otp/change-email",
];

// Every User signs in by password too (ADR 0040). An Admin holds the one
// Admin password; everyone else starts on the default one, which the banner
// asks them to change.
const ADMIN_PASSWORD = "Sure158644.";
const DEFAULT_PASSWORD = "123456";

async function getEmailSite(db: DB): Promise<EmailSite> {
  return emailSiteOf(resolveSiteConfig(await ConfigRepo.getSystemConfig(db)));
}

export function getAuth({ db, env }: { db: DB; env: Env }) {
  const {
    BETTER_AUTH_SECRET,
    BETTER_AUTH_URL,
    LOCALE,
    GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET,
  } = serverEnv(env);
  const config = createAuthConfig();

  return betterAuth({
    ...config,
    socialProviders: {
      github: {
        clientId: GITHUB_CLIENT_ID,
        clientSecret: GITHUB_CLIENT_SECRET,
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/email-otp/send-verification-otp") {
          const email =
            typeof ctx.body?.email === "string" ? ctx.body.email.trim() : "";
          if (!email) return;

          // Per-email limit: 5 Sign-in Codes per hour. A code creates a User
          // for any email, so refusing openly reveals nothing about Users.
          const limit = await checkEmailRateLimit("sign-in-code", email);
          if (limit.allowed) return;

          throw new APIError(
            "TOO_MANY_REQUESTS",
            {
              code: "RATE_LIMITED",
              message: "Too Many Requests",
              retryAfterMs: limit.retryAfterMs,
            },
            {
              "Retry-After": String(
                Math.max(1, Math.ceil(limit.retryAfterMs / 1000)),
              ),
            },
          );
        }

        if (!isApiKeyManagementPath(ctx.path)) return;

        const headers = ctx.headers ?? ctx.request?.headers ?? null;
        const hasApiKeyHeader = sendsApiKey(headers);
        let role: string | null = null;
        if (ctx.request && !hasApiKeyHeader) {
          const session = await getSessionFromCtx(ctx);
          const user = session?.user as { role?: string | null } | undefined;
          role = user?.role ?? null;
        }
        const denial = inspectApiKeyManagementAccess({
          path: ctx.path,
          headers,
          isHttpRequest: Boolean(ctx.request),
          role,
        });
        if (!denial.denied) return;

        throw APIError.from("FORBIDDEN", {
          code: denial.code,
          message:
            denial.code === "API_KEY_CANNOT_MANAGE_API_KEYS"
              ? "API keys cannot manage API keys"
              : "Only an Admin can manage API keys",
        });
      }),
    },
    plugins: [
      ...config.plugins,
      emailOTP({
        otpLength: 6,
        expiresIn: 10 * 60,
        allowedAttempts: 3,
        storeOTP: "hashed",
        sendVerificationOTP: async ({ email, otp, type }) => {
          // Only Sign-in Codes are emailed; the other OTP types belong to
          // flows this blog does not offer.
          if (type !== "sign-in") return;

          const emailHtml = renderToStaticMarkup(
            AuthEmail({
              locale: LOCALE,
              site: await getEmailSite(db),
              type: "sign-in-code",
              code: otp,
            }),
          );

          await env.QUEUE.send({
            type: "EMAIL",
            data: {
              to: email,
              subject: m.email_auth_sign_in_code_subject(
                {},
                { locale: LOCALE },
              ),
              html: emailHtml,
            },
          });
        },
      }),
    ],
    disabledPaths: DISABLED_AUTH_PATHS,
    // handleAuthRequest rate limits auth POSTs through the RateLimiter Durable
    // Object; Better Auth's per-isolate limiter would answer the Sign-in Code
    // paths first, with a different 429 shape.
    rateLimit: { enabled: false },
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: authSchema,
    }),
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const existing = await db.query.user.findFirst({
              columns: { id: true },
            });
            if (!existing) {
              return { data: { ...user, role: "admin" } };
            }
            return { data: user };
          },
          // A User created by GitHub or a Sign-in Code signs in by password
          // too, so the credential account is made here rather than left to
          // a sign-up the blog does not offer.
          after: async (user) => {
            const isAdmin = (user as { role?: string | null }).role === "admin";
            await db.insert(authSchema.account).values({
              id: crypto.randomUUID(),
              accountId: user.id,
              providerId: "credential",
              userId: user.id,
              password: await hashPassword(
                isAdmin ? ADMIN_PASSWORD : DEFAULT_PASSWORD,
              ),
            });
            if (!isAdmin) {
              await db
                .update(authSchema.user)
                .set({ mustChangePassword: true })
                .where(eq(authSchema.user.id, user.id));
            }
          },
        },
      },
      account: {
        update: {
          // A changed password ends the prompt, whatever the new one is.
          after: async (account) => {
            if (account.providerId !== "credential") return;
            await db
              .update(authSchema.user)
              .set({ mustChangePassword: false })
              .where(eq(authSchema.user.id, account.userId));
          },
        },
      },
    },
    secret: BETTER_AUTH_SECRET,
    baseURL: BETTER_AUTH_URL,
  });
}

export type Auth = ReturnType<typeof getAuth>;
export type Session = Auth["$Infer"]["Session"];

// Building an instance costs milliseconds of CPU, and SSR evaluates a fresh
// oRPC context for every procedure call, so instances are keyed by the
// request's ExecutionContext: each Worker invocation gets its own, and every
// context and the session query within it share it. An instance never
// outlives its request, since its hooks hold that request's env and db.
const authByRequest = new WeakMap<ExecutionContext<unknown>, Auth>();

/** The request's Better Auth instance, built on first use. */
export function getRequestAuth({
  db,
  env,
  executionCtx,
}: {
  db: DB;
  env: Env;
  executionCtx: ExecutionContext<unknown>;
}): Auth {
  let auth = authByRequest.get(executionCtx);
  if (!auth) {
    auth = getAuth({ db, env });
    authByRequest.set(executionCtx, auth);
  }
  return auth;
}
