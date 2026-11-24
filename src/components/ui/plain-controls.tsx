import type { ComponentPropsWithRef } from "react";

/**
 * Unstyled native controls for self-contained widget islands (the toolbox
 * apps and games). Those surfaces own their whole look — game boards, keypads,
 * compact tool rows — so the Fuwari primitives' sizes and fills would fight
 * them. Keeping the bare elements here means the rest of the site still
 * routes every control through a UI primitive.
 */
export function PlainButton(props: ComponentPropsWithRef<"button">) {
  return <button {...props} />;
}

export function PlainInput(props: ComponentPropsWithRef<"input">) {
  return <input {...props} />;
}

export function PlainSelect(props: ComponentPropsWithRef<"select">) {
  return <select {...props} />;
}

export function PlainTextarea(props: ComponentPropsWithRef<"textarea">) {
  return <textarea {...props} />;
}
