import { z } from "zod/mini";

/** `?redirectTo=` of the sign-in page. */
export const loginSearchSchema = z.object({
  redirectTo: z.optional(z.string()),
});

/** The same of an old entry point, which leads to the sign-in page whatever it is given. */
export const legacyAuthSearchSchema = z.object({
  redirectTo: z.catch(z.optional(z.string()), undefined),
});

/** `?token=` and `?error=` of the page a password-reset link lands on. */
export const resetPasswordSearchSchema = z.object({
  token: z.catch(z.optional(z.string()), undefined),
  error: z.catch(z.optional(z.string()), undefined),
});

/** `?error=` of the page an email-verification link lands on. */
export const verifyEmailSearchSchema = z.object({
  error: z.catch(z.optional(z.string()), undefined),
});
