import { KeyRound } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { buttonClass } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { m } from "@/paraglide/messages";
import "./password-change-banner.css";

/**
 * Asks a User who still signs in with the default password to change it. It
 * floats over the bottom of the window, outside the shell, and leaves the
 * pages themselves as they are until the User acts on it.
 */
export function PasswordChangeBanner() {
  return (
    <aside className="password-change-banner">
      <Callout
        tone="warning"
        icon={KeyRound}
        action={
          <Link
            to="/profile"
            className={buttonClass({ variant: "primary", size: "sm" })}
          >
            {m.password_banner_action()}
          </Link>
        }
      >
        {m.password_banner_notice()}
      </Callout>
    </aside>
  );
}
