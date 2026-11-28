import {
  createFileRoute,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import { verifyEmailSearchSchema } from "@/features/auth/auth-search";
import { m } from "@/paraglide/messages";

const VerifyEmailContent = lazyRouteComponent(
  () => import("@/features/auth/components/auth-route-content"),
  "VerifyEmailRouteContent",
);

export const Route = createFileRoute("/_public/_auth/verify-email")({
  validateSearch: verifyEmailSearchSchema,
  beforeLoad: ({ context }) => {
    if (!context.isEmailConfigured) {
      throw redirect({ to: "/login" });
    }
  },
  component: RouteComponent,
  head: () => ({
    meta: [
      {
        title: m.verify_email_title(),
      },
    ],
  }),
});

function RouteComponent() {
  const { error } = Route.useSearch();
  return <VerifyEmailContent error={error} />;
}
