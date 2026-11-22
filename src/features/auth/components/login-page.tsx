import { Check, CircleAlert } from "lucide-react";
import { type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { GithubIcon } from "@/components/common/brand-icon";
import type { useLoginForm } from "../hooks/use-login-form";
import type { useSocialLogin } from "../hooks/use-social-login";
import { Callout } from "@/components/ui/callout";
import { StatusText } from "@/components/ui/status-text";
import { SIGN_IN_CODE_LENGTH } from "../utils/sign-in-code";
import { m } from "@/paraglide/messages";
import { AuthHeading } from "./auth-elements";
import { PublicNameForm } from "./public-name-form";

interface LoginPageProps {
  isEmailConfigured: boolean;
  loginForm: ReturnType<typeof useLoginForm> & { turnstilePending: boolean };
  socialLogin: ReturnType<typeof useSocialLogin>;
  turnstileElement: ReactNode;
}

export function LoginPage({
  isEmailConfigured,
  loginForm,
  socialLogin,
  turnstileElement,
}: LoginPageProps) {
  const {
    step,
    method,
    email,
    error,
    signedIn,
    isSubmitting,
    isResending,
    resendSecondsLeft,
    turnstilePending,
  } = loginForm;
  const busy = isSubmitting || signedIn || socialLogin.isLoading || isResending;
  const passwordMode = step === "email" && method === "password";
  const emailForm = passwordMode ? loginForm.passwordForm : loginForm.emailForm;
  const heading =
    step === "code"
      ? {
          title: m.login_code_title(),
          description: m.login_code_desc({ email }),
        }
      : step === "name"
        ? { title: m.login_name_title(), description: m.login_name_desc() }
        : { title: m.login_title(), description: m.login_welcome_back() };

  return (
    <div className="auth-page">
      <AuthHeading title={heading.title} description={heading.description} />
      {step === "email" && (
        <>
          <Button
            variant={isEmailConfigured ? "regular" : "primary"}
            size="lg"
            onClick={socialLogin.handleGithubLogin}
            disabled={busy}
            loading={socialLogin.isLoading}
            icon={<GithubIcon size={18} />}
            className="auth-action"
          >
            {socialLogin.isLoading
              ? m.login_social_connecting()
              : m.login_github_continue()}
          </Button>
          {socialLogin.errorMessage && (
            <StatusText error>{socialLogin.errorMessage}</StatusText>
          )}
          {isEmailConfigured && (
            <div className="auth-divider">
              <span>{m.login_email_alternative()}</span>
            </div>
          )}
        </>
      )}
      {step === "name" ? (
        <PublicNameForm onSaved={loginForm.finish} />
      ) : (
        <form
          className="auth-form"
          onSubmit={loginForm.handleSubmit}
          noValidate
        >
          {step === "email" && isEmailConfigured && (
            <div className="auth-methods" role="tablist">
              <Button
                role="tab"
                aria-selected={method === "code"}
                variant={method === "code" ? "regular" : "text"}
                size="sm"
                disabled={busy}
                onClick={() => loginForm.selectMethod("code")}
              >
                {m.login_method_code()}
              </Button>
              <Button
                role="tab"
                aria-selected={method === "password"}
                variant={method === "password" ? "regular" : "text"}
                size="sm"
                disabled={busy}
                onClick={() => loginForm.selectMethod("password")}
              >
                {m.login_method_password()}
              </Button>
            </div>
          )}
          {step === "code" ? (
            <FormField
              key="code"
              label={m.login_code_label()}
              error={loginForm.codeForm.errors.code?.message}
              required
            >
              <Input
                {...loginForm.codeForm.register("code")}
                className="auth-code-input"
                inputMode="numeric"
                autoFocus
                autoComplete="one-time-code"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={"0".repeat(SIGN_IN_CODE_LENGTH)}
                disabled={busy}
              />
            </FormField>
          ) : (
            <>
              <FormField
                key="email"
                label={m.login_email_address()}
                error={emailForm.errors.email?.message}
                required
              >
                <Input
                  {...emailForm.register("email")}
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder={m.login_email_placeholder()}
                  disabled={busy}
                />
              </FormField>
              {passwordMode && (
                <FormField
                  key="password"
                  label={m.login_password_label()}
                  error={loginForm.passwordForm.errors.password?.message}
                  required
                >
                  <PasswordInput
                    {...loginForm.passwordForm.register("password")}
                    autoComplete="current-password"
                    placeholder={m.login_password_placeholder()}
                    disabled={busy}
                  />
                </FormField>
              )}
            </>
          )}
          {error && (
            <Callout tone="danger" icon={CircleAlert} role="alert">
              {error}
            </Callout>
          )}
          {!passwordMode && (
            <div className="auth-verification">{turnstileElement}</div>
          )}
          {passwordMode ? (
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="auth-action"
              disabled={busy}
              loading={isSubmitting}
              icon={signedIn ? <Check size={16} /> : null}
            >
              {isSubmitting
                ? m.login_submitting()
                : signedIn
                  ? m.login_toast_success()
                  : m.login_password_submit()}
            </Button>
          ) : step === "email" ? (
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="auth-action"
              disabled={busy || turnstilePending}
              loading={isSubmitting}
            >
              {isSubmitting ? m.login_code_sending() : m.login_email_submit()}
            </Button>
          ) : (
            <>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="auth-action"
                disabled={busy}
                loading={isSubmitting}
                icon={signedIn ? <Check size={16} /> : null}
              >
                {isSubmitting
                  ? m.login_submitting()
                  : signedIn
                    ? m.login_toast_success()
                    : m.login_code_submit()}
              </Button>
              <div className="auth-code-actions">
                <Button
                  variant="text"
                  onClick={loginForm.resend}
                  disabled={busy || turnstilePending || resendSecondsLeft > 0}
                  loading={isResending}
                >
                  {resendSecondsLeft > 0
                    ? m.login_code_resend_in({
                        seconds: String(resendSecondsLeft),
                      })
                    : m.login_code_resend()}
                </Button>
                <Button
                  variant="text"
                  onClick={loginForm.changeEmail}
                  disabled={busy}
                >
                  {m.login_code_change_email()}
                </Button>
              </div>
            </>
          )}
        </form>
      )}
    </div>
  );
}
