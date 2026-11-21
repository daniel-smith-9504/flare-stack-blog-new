import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "@/lib/toast";
import { z } from "zod";
import { markPasswordChanged } from "@/features/auth/queries";
import { getAuthClient } from "@/lib/auth/auth-client";
import { getProfileAuthErrorMessage } from "@/lib/auth/auth-errors";
import { m } from "@/paraglide/messages";

const MIN_PASSWORD_LENGTH = 6;

const createPasswordSchema = () =>
  z
    .object({
      currentPassword: z
        .string()
        .min(1, m.password_change_validation_current()),
      newPassword: z
        .string()
        .min(MIN_PASSWORD_LENGTH, m.password_validation_too_short()),
      confirmPassword: z.string(),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
      path: ["confirmPassword"],
      message: m.password_change_validation_mismatch(),
    });

type PasswordSchema = z.infer<ReturnType<typeof createPasswordSchema>>;

/**
 * The signed-in User's own password change. Better Auth ends the default
 * password's prompt in the same request, so the session looks again for
 * `mustChangePassword` as it arrives.
 */
export function useChangePassword() {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<{
    error: boolean;
    message: string;
  } | null>(null);
  const form = useForm<PasswordSchema>({
    resolver: standardSchemaResolver(createPasswordSchema()),
  });

  const onSubmit = async (data: PasswordSchema) => {
    setFeedback(null);
    try {
      const { error } = await getAuthClient().changePassword({
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      });
      if (error) {
        setFeedback({
          error: true,
          message:
            getProfileAuthErrorMessage(error) ?? m.auth_error_default_desc(),
        });
        return;
      }
      form.reset();
      markPasswordChanged(queryClient);
      setFeedback({ error: false, message: m.password_change_success() });
      toast.success(m.password_change_success());
    } catch {
      setFeedback({ error: true, message: m.password_change_failed() });
    }
  };

  return {
    register: form.register,
    errors: form.formState.errors,
    handleSubmit: form.handleSubmit(onSubmit),
    isSubmitting: form.formState.isSubmitting,
    feedback,
  };
}
