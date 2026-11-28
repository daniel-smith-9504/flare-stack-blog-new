import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { getAuthClient } from "@/lib/auth/auth-client";
import { getForgotPasswordAuthErrorMessage } from "@/lib/auth/auth-errors";
import { toast } from "@/lib/toast";
import { m } from "@/paraglide/messages";

const createForgotPasswordSchema = () =>
  z.object({
    email: z.email(m.register_validation_email_invalid()),
  });

type ForgotPasswordSchema = z.infer<
  ReturnType<typeof createForgotPasswordSchema>
>;

interface UseForgotPasswordFormOptions {
  turnstileToken: string | null;
  turnstilePending: boolean;
  resetTurnstile: () => void;
}

export function useForgotPasswordForm(options: UseForgotPasswordFormOptions) {
  const { turnstileToken, turnstilePending, resetTurnstile } = options;

  const [isSent, setIsSent] = useState(false);
  const [sentEmail, setSentEmail] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<ForgotPasswordSchema>({
    resolver: standardSchemaResolver(createForgotPasswordSchema()),
  });

  const onSubmit = async (data: ForgotPasswordSchema) => {
    setSubmitError(null);
    try {
      const { error } = await getAuthClient().requestPasswordReset({
        email: data.email,
        redirectTo: `${window.location.origin}/reset-link`,
        fetchOptions: {
          headers: { "X-Turnstile-Token": turnstileToken || "" },
        },
      });

      if (error) {
        setSubmitError(
          getForgotPasswordAuthErrorMessage(error) ??
            m.auth_error_default_desc(),
        );
        return;
      }
    } catch {
      setSubmitError(m.auth_error_default_desc());
      return;
    } finally {
      resetTurnstile();
    }

    setSentEmail(data.email);
    setIsSent(true);
    toast.success(m.forgot_password_toast_sent(), {
      description: m.forgot_password_toast_sent_desc(),
    });
  };

  return {
    register: form.register,
    errors: form.formState.errors,
    handleSubmit: form.handleSubmit(onSubmit),
    isSubmitting: form.formState.isSubmitting,
    submitError,
    isSent,
    sentEmail,
    turnstilePending,
  };
}
