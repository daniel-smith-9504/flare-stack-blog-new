import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { resetAuthBoundQueries } from "@/features/auth/queries";
import { getAuthClient } from "@/lib/auth/auth-client";
import { getRegisterAuthErrorMessage } from "@/lib/auth/auth-errors";
import { toast } from "@/lib/toast";
import { m } from "@/paraglide/messages";

const createRegisterSchema = () =>
  z
    .object({
      name: z
        .string()
        .min(2, m.register_validation_name_min())
        .max(20, m.register_validation_name_max()),
      email: z.email(m.register_validation_email_invalid()),
      password: z.string().min(8, m.register_validation_password_min()),
      confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: m.register_validation_password_mismatch(),
      path: ["confirmPassword"],
    });

type RegisterSchema = z.infer<ReturnType<typeof createRegisterSchema>>;

interface UseRegisterFormOptions {
  turnstileToken: string | null;
  turnstilePending: boolean;
  resetTurnstile: () => void;
}

export function useRegisterForm(options: UseRegisterFormOptions) {
  const { turnstileToken, turnstilePending, resetTurnstile } = options;

  const [isSuccess, setIsSuccess] = useState(false);
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<RegisterSchema>({
    resolver: standardSchemaResolver(createRegisterSchema()),
  });

  const onSubmit = async (data: RegisterSchema) => {
    setSubmitError(null);
    try {
      const { error } = await getAuthClient().signUp.email({
        email: data.email,
        password: data.password,
        name: data.name,
        callbackURL: `${window.location.origin}/verify-email`,
        fetchOptions: {
          headers: { "X-Turnstile-Token": turnstileToken || "" },
        },
      });

      if (error) {
        setSubmitError(
          getRegisterAuthErrorMessage(error) ?? m.register_error_default(),
        );
        return;
      }
    } catch {
      setSubmitError(m.register_error_default());
      return;
    } finally {
      resetTurnstile();
    }

    resetAuthBoundQueries(queryClient, "signed-out");
    setIsSuccess(true);
    toast.success(m.register_toast_created(), {
      description: m.register_toast_verification_sent(),
    });
  };

  return {
    register: form.register,
    errors: form.formState.errors,
    handleSubmit: form.handleSubmit(onSubmit),
    isSubmitting: form.formState.isSubmitting,
    submitError,
    isSuccess,
    turnstilePending,
  };
}
