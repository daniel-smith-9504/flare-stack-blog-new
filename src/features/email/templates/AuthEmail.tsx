import type { Locale } from "@/lib/i18n";
import { m } from "@/paraglide/messages";
import {
  EmailButton,
  EmailCode,
  EmailHeading,
  EmailLayout,
  EmailLink,
  EmailNote,
  EmailText,
} from "./EmailLayout";
import type { EmailSite } from "./email-theme";

type AuthEmailProps = {
  locale: Locale;
  site: EmailSite;
} & (
  | { type: "sign-in-code"; code: string }
  | { type: "verification" | "reset-password"; url: string }
);

export const AuthEmail = (props: AuthEmailProps) => {
  const { locale, site, type } = props;

  if (type === "sign-in-code") {
    const title = m.email_auth_sign_in_code_subject({}, { locale });

    return (
      <EmailLayout locale={locale} previewText={title} site={site}>
        <EmailHeading>{title}</EmailHeading>
        <EmailText>{m.email_auth_sign_in_code_desc({}, { locale })}</EmailText>
        <EmailCode>{props.code}</EmailCode>
        <EmailNote>
          {m.email_auth_sign_in_code_expiry({}, { locale })}
        </EmailNote>
        <EmailNote>
          {m.email_auth_sign_in_code_ignore({}, { locale })}
        </EmailNote>
      </EmailLayout>
    );
  }

  const isVerification = type === "verification";
  const title = isVerification
    ? m.email_auth_verification_subject({}, { locale })
    : m.email_auth_reset_subject({}, { locale });
  const description = isVerification
    ? m.email_auth_verification_desc({}, { locale })
    : m.email_auth_reset_desc({}, { locale });
  const buttonText = isVerification
    ? m.email_auth_verification_action({}, { locale })
    : m.email_auth_reset_action({}, { locale });

  return (
    <EmailLayout locale={locale} previewText={title} site={site}>
      <EmailHeading>{title}</EmailHeading>
      <EmailText>{description}</EmailText>
      <EmailButton href={props.url}>{buttonText}</EmailButton>
      <EmailNote>
        {m.email_auth_link_fallback({}, { locale })}
        <br />
        <EmailLink href={props.url}>{props.url}</EmailLink>
      </EmailNote>
      <EmailNote>{m.email_auth_expiry_notice({}, { locale })}</EmailNote>
    </EmailLayout>
  );
};
