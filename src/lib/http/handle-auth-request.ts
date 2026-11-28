import { getAuth } from "@/lib/auth/auth.server";
import { getDb } from "@/lib/db";
import { enforceIpRateLimit } from "./rate-limit";
import { enforceTurnstile } from "./turnstile";

// Paths that create an account or send an email need a human.
const TURNSTILE_PROTECTED_PATHS = new Set([
  "/api/auth/email-otp/send-verification-otp",
  "/api/auth/sign-up/email",
  "/api/auth/request-password-reset",
  "/api/auth/send-verification-email",
]);

// Entering a code, or a password, gets a tighter hourly budget than the other
// auth POSTs, and no Turnstile: the human check already happened when the
// code was sent, and a password form cannot wait for one.
const SIGN_IN_CODE_PATHS = new Set([
  ...TURNSTILE_PROTECTED_PATHS,
  "/api/auth/sign-in/email-otp",
  "/api/auth/sign-in/email",
]);

export async function handleAuthRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;

  if (request.method === "POST") {
    if (TURNSTILE_PROTECTED_PATHS.has(pathname)) {
      const turnstileResponse = await enforceTurnstile(env, request);
      if (turnstileResponse) return turnstileResponse;
    }

    if (SIGN_IN_CODE_PATHS.has(pathname)) {
      const minuteLimit = await enforceIpRateLimit(request, {
        capacity: 5,
        interval: "1m",
        key: `auth:${pathname}:1m`,
      });
      if (minuteLimit) return minuteLimit;

      const hourlyLimit = await enforceIpRateLimit(request, {
        capacity: 10,
        interval: "1h",
        key: `auth:${pathname}:1h`,
      });
      if (hourlyLimit) return hourlyLimit;
    } else {
      const minuteLimit = await enforceIpRateLimit(request, {
        capacity: 5,
        interval: "1m",
        key: `auth:${pathname}:1m`,
      });
      if (minuteLimit) return minuteLimit;
    }
  }

  const db = getDb(env);
  const auth = getAuth({ db, env });
  return auth.handler(request);
}
