import { z } from "zod/mini";

const clientEnvSchema = z.object({
  VITE_TURNSTILE_SITE_KEY: z.optional(z.string()),
});

export function clientEnv() {
  return clientEnvSchema.parse(import.meta.env);
}
