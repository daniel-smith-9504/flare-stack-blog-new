import {
  createFileRoute,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import { m } from "@/paraglide/messages";

const ForgotPasswordContent = lazyRouteComponent(
  () => import("@/features/auth/components/auth-route-content"),
  "ForgotPasswordRouteContent",
);

export const Route = createFileRoute("/_public/_auth/forgot-password")({
  beforeLoad: ({ context }) => {
    if (!context.isEmailConfigured) {
      throw redirect({ to: "/login" });
    }
  },
  component: ForgotPasswordContent,
  head: () => ({
    meta: [
      {
        title: m.forgot_password_title(),
      },
    ],
  }),
});
