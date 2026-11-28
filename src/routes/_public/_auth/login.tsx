import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { loginSearchSchema } from "@/features/auth/auth-search";
import { m } from "@/paraglide/messages";

const LoginContent = lazyRouteComponent(
  () => import("@/features/auth/components/auth-route-content"),
  "LoginRouteContent",
);

export const Route = createFileRoute("/_public/_auth/login")({
  validateSearch: loginSearchSchema,
  component: RouteComponent,
  head: () => ({
    meta: [
      {
        title: m.login_title(),
      },
    ],
  }),
});

function RouteComponent() {
  const { redirectTo } = Route.useSearch();
  return <LoginContent redirectTo={redirectTo} />;
}
