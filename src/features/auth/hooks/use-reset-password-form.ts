import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { resetAuthBoundQueries } from "@/features/auth/queries";
import { getAuthClient } from "@/lib/auth/auth-client";
import { getResetPasswordAuthErrorMessage } from "@/lib/auth/auth-errors";
import { toast } from "@/lib/toast";
import { m } from "@/paraglide/messages";

const createResetPasswordSchema = () =>
  z
    .object({
      password: z.string().min(8, m.register_validation_password_min()),
      confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: m.register_validation_password_mismatch(),
      path: ["confirmPassword"],
    });

type ResetPasswordSchema = z.infer<
  ReturnType<typeof createResetPasswordSchema>
>;

interface UseResetPasswordFormOptions {
  token: string | undefined;
}

export function useResetPasswordForm(options: UseResetPasswordFormOptions) {
  const { token } = options;

  const [isSuccess, setIsSuccess] = useState(false);
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<ResetPasswordSchema>({
    resolver: standardSchemaResolver(createResetPasswordSchema()),
  });

  const onSubmit = async (data: ResetPasswordSchema) => {
    if (!token) {
      toast.error(m.reset_password_toast_missing_token());
      return;
    }

    setSubmitError(null);
    try {
      const { error } = await getAuthClient().resetPassword({
        newPassword: data.password,
        token,
      });

      if (error) {
        setSubmitError(
          getResetPasswordAuthErrorMessage(error) ??
            m.reset_password_toast_failed_desc(),
        );
        return;
      }
    } catch {
      setSubmitError(m.reset_password_toast_failed_desc());
      return;
    }

    resetAuthBoundQueries(queryClient, "signed-out");
    toast.success(m.reset_password_toast_success(), {
      description: m.reset_password_toast_success_desc(),
    });
    form.reset();
    setIsSuccess(true);
  };

  return {
    register: form.register,
    errors: form.formState.errors,
    handleSubmit: form.handleSubmit(onSubmit),
    isSubmitting: form.formState.isSubmitting,
    submitError,
    isSuccess,
  };
}
