import {
  createFileRoute,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import { m } from "@/paraglide/messages";

const RegisterContent = lazyRouteComponent(
  () => import("@/features/auth/components/auth-route-content"),
  "RegisterRouteContent",
);

export const Route = createFileRoute("/_public/_auth/register")({
  beforeLoad: ({ context }) => {
    if (!context.isEmailConfigured) {
      throw redirect({ to: "/login" });
    }
  },
  component: RegisterContent,
  head: () => ({
    meta: [
      {
        title: m.register_title(),
      },
    ],
  }),
});
