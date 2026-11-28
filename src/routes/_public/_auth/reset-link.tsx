import {
  createFileRoute,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import { resetPasswordSearchSchema } from "@/features/auth/auth-search";
import { m } from "@/paraglide/messages";

const ResetPasswordContent = lazyRouteComponent(
  () => import("@/features/auth/components/auth-route-content"),
  "ResetPasswordRouteContent",
);

export const Route = createFileRoute("/_public/_auth/reset-link")({
  validateSearch: resetPasswordSearchSchema,
  beforeLoad: ({ context }) => {
    if (!context.isEmailConfigured) {
      throw redirect({ to: "/login" });
    }
  },
  component: RouteComponent,
  head: () => ({
    meta: [
      {
        title: m.reset_password_title(),
      },
    ],
  }),
});

function RouteComponent() {
  const { token, error } = Route.useSearch();
  return <ResetPasswordContent token={token} error={error} />;
}
