import { useRouteContext } from "@tanstack/react-router";
import { Turnstile, useTurnstile } from "@/components/common/turnstile";
import {
  useForgotPasswordForm,
  useLoginForm,
  useRegisterForm,
  useResetPasswordForm,
  useSocialLogin,
  useVerifyEmail,
} from "../hooks";
import { ForgotPasswordPage } from "./forgot-password-page";
import { LoginPage } from "./login-page";
import { RegisterPage } from "./register-page";
import { ResetPasswordPage } from "./reset-password-page";
import { VerifyEmailPage } from "./verify-email-page";

// The auth pages, kept out of the first load with the route component that
// mounts them.

export function LoginRouteContent({ redirectTo }: { redirectTo?: string }) {
  const { isEmailConfigured } = useRouteContext({ from: "/_public/_auth" });
  const {
    isPending: turnstilePending,
    token: turnstileToken,
    reset: resetTurnstile,
    turnstileProps,
  } = useTurnstile("login");

  const loginForm = useLoginForm({
    turnstileToken,
    resetTurnstile,
    redirectTo,
    emailCodeEnabled: isEmailConfigured,
  });

  const socialLogin = useSocialLogin({ redirectTo });

  return (
    <LoginPage
      isEmailConfigured={isEmailConfigured}
      loginForm={{ ...loginForm, turnstilePending }}
      socialLogin={socialLogin}
      turnstileElement={
        isEmailConfigured ? <Turnstile {...turnstileProps} /> : null
      }
    />
  );
}

export function RegisterRouteContent() {
  const {
    isPending: turnstilePending,
    token: turnstileToken,
    reset: resetTurnstile,
    turnstileProps,
  } = useTurnstile("register");

  const registerForm = useRegisterForm({
    turnstileToken,
    turnstilePending,
    resetTurnstile,
  });

  return (
    <RegisterPage
      registerForm={registerForm}
      turnstileElement={<Turnstile {...turnstileProps} />}
    />
  );
}

export function ForgotPasswordRouteContent() {
  const {
    isPending: turnstilePending,
    token: turnstileToken,
    reset: resetTurnstile,
    turnstileProps,
  } = useTurnstile("forgot-password");

  const forgotPasswordForm = useForgotPasswordForm({
    turnstileToken,
    turnstilePending,
    resetTurnstile,
  });

  return (
    <ForgotPasswordPage
      forgotPasswordForm={{
        ...forgotPasswordForm,
        turnstilePending,
      }}
      turnstileElement={<Turnstile {...turnstileProps} />}
    />
  );
}

export function ResetPasswordRouteContent({
  token,
  error,
}: {
  token: string | undefined;
  error: string | undefined;
}) {
  const resetPasswordForm = useResetPasswordForm({ token });

  return (
    <ResetPasswordPage
      resetPasswordForm={resetPasswordForm}
      token={token}
      error={error}
    />
  );
}

export function VerifyEmailRouteContent({ error }: { error?: string }) {
  const { status } = useVerifyEmail({ error });

  return <VerifyEmailPage status={status} error={error} />;
}
