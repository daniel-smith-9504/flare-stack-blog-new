import type { BetterAuthErrorCode } from "@/lib/auth/auth-client";
import { m } from "@/paraglide/messages";

const CUSTOM_AUTH_ERROR_CODES = [
  "RATE_LIMITED",
  "TURNSTILE_MISSING_TOKEN",
  "TURNSTILE_VERIFICATION_FAILED",
] as const;

type CustomAuthErrorCode = (typeof CUSTOM_AUTH_ERROR_CODES)[number];

const COMMON_AUTH_ERROR_CODES = [
  "USER_NOT_FOUND",
  "USER_ALREADY_EXISTS",
  "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
  "SESSION_EXPIRED",
  "INVALID_OTP",
  "OTP_EXPIRED",
  "TOO_MANY_ATTEMPTS",
  "INVALID_EMAIL_OR_PASSWORD",
  "INVALID_PASSWORD",
  "PASSWORD_TOO_SHORT",
  "INVALID_TOKEN",
  "CREDENTIAL_ACCOUNT_NOT_FOUND",
  "EMAIL_NOT_VERIFIED",
] as const satisfies ReadonlyArray<BetterAuthErrorCode>;

type CommonAuthErrorCode = (typeof COMMON_AUTH_ERROR_CODES)[number];

export interface AuthClientErrorLike {
  code?: string | null;
  retryAfterMs?: number | null;
}

function getErrorCode(error: AuthClientErrorLike | null | undefined) {
  return typeof error?.code === "string" ? error.code : undefined;
}

function isCustomAuthErrorCode(code: string): code is CustomAuthErrorCode {
  return CUSTOM_AUTH_ERROR_CODES.some(
    (authErrorCode) => authErrorCode === code,
  );
}

function isCommonAuthErrorCode(code: string): code is CommonAuthErrorCode {
  return COMMON_AUTH_ERROR_CODES.some(
    (authErrorCode) => authErrorCode === code,
  );
}

function getCustomAuthErrorMessage(
  error: AuthClientErrorLike | null | undefined,
): string | undefined {
  const code = getErrorCode(error);
  if (!code || !isCustomAuthErrorCode(code)) return undefined;

  switch (code) {
    case "TURNSTILE_MISSING_TOKEN":
    case "TURNSTILE_VERIFICATION_FAILED":
      return m.turnstile_error_failed_desc();
    case "RATE_LIMITED": {
      const seconds =
        typeof error?.retryAfterMs === "number"
          ? Math.max(1, Math.ceil(error.retryAfterMs / 1000))
          : 60;

      return m.request_error_rate_limited_desc({
        seconds: String(seconds),
      });
    }
  }
}

function getSharedAuthErrorMessage(
  error: AuthClientErrorLike | null | undefined,
): string | undefined {
  const customMessage = getCustomAuthErrorMessage(error);
  if (customMessage) return customMessage;

  const code = getErrorCode(error);
  if (!code || !isCommonAuthErrorCode(code)) return undefined;

  switch (code) {
    case "USER_NOT_FOUND":
      return m.auth_error_user_not_found();
    case "SESSION_EXPIRED":
      return m.auth_error_session_expired();
    case "INVALID_OTP":
      return m.auth_error_invalid_otp();
    case "OTP_EXPIRED":
      return m.auth_error_otp_expired();
    case "TOO_MANY_ATTEMPTS":
      return m.auth_error_otp_too_many_attempts();
    case "INVALID_EMAIL_OR_PASSWORD":
      return m.auth_error_invalid_email_or_password();
    case "INVALID_PASSWORD":
      return m.auth_error_invalid_password();
    case "PASSWORD_TOO_SHORT":
      return m.password_validation_too_short();
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return m.auth_error_user_already_exists();
    case "INVALID_TOKEN":
      return m.auth_error_invalid_token();
    case "CREDENTIAL_ACCOUNT_NOT_FOUND":
      return m.auth_error_credential_not_found();
    case "EMAIL_NOT_VERIFIED":
      return m.login_error_email_not_verified();
  }
}

/** The password was right, but the address behind it is not verified yet. */
export function isEmailNotVerifiedError(
  error: AuthClientErrorLike | null | undefined,
) {
  return getErrorCode(error) === "EMAIL_NOT_VERIFIED";
}

export function getLoginAuthErrorMessage(
  error: AuthClientErrorLike | null | undefined,
): string | undefined {
  if (isEmailNotVerifiedError(error)) {
    return m.login_error_email_not_verified();
  }
  return getSharedAuthErrorMessage(error);
}

export function getRegisterAuthErrorMessage(
  error: AuthClientErrorLike | null | undefined,
): string | undefined {
  return getSharedAuthErrorMessage(error);
}

export function getForgotPasswordAuthErrorMessage(
  error: AuthClientErrorLike | null | undefined,
): string | undefined {
  return getSharedAuthErrorMessage(error);
}

export function getResetPasswordAuthErrorMessage(
  error: AuthClientErrorLike | null | undefined,
): string | undefined {
  return getSharedAuthErrorMessage(error);
}

/** The code can no longer be used, so the user has to request a new one. */
export function isSignInCodeSpentError(
  error: AuthClientErrorLike | null | undefined,
) {
  const code = getErrorCode(error);
  return code === "OTP_EXPIRED" || code === "TOO_MANY_ATTEMPTS";
}

/** How long the server asks the client to wait, when it rate limited us. */
export function getRetryAfterMs(error: AuthClientErrorLike | null | undefined) {
  const retryAfterMs = error?.retryAfterMs;
  return getErrorCode(error) === "RATE_LIMITED" &&
    typeof retryAfterMs === "number" &&
    Number.isFinite(retryAfterMs) &&
    retryAfterMs > 0
    ? retryAfterMs
    : undefined;
}

export function getSignInCodeAuthErrorMessage(
  error: AuthClientErrorLike | null | undefined,
): string | undefined {
  return getSharedAuthErrorMessage(error);
}

export function getPasswordAuthErrorMessage(
  error: AuthClientErrorLike | null | undefined,
): string | undefined {
  return getSharedAuthErrorMessage(error);
}

export function getSocialLoginAuthErrorMessage(
  error: AuthClientErrorLike | null | undefined,
): string | undefined {
  return getSharedAuthErrorMessage(error);
}

export function getProfileAuthErrorMessage(
  error: AuthClientErrorLike | null | undefined,
): string | undefined {
  return getSharedAuthErrorMessage(error);
}

export function getLogoutAuthErrorMessage(
  error: AuthClientErrorLike | null | undefined,
): string | undefined {
  return getSharedAuthErrorMessage(error);
}
