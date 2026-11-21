import { z } from "zod";
import { notificationEventSchema } from "@/features/notification/notification.schema";
import { webhookEndpointSchema } from "@/features/webhook/webhook.schema";
import { EMAIL_UNSUBSCRIBE_TYPES, NOVEL_FILE_FORMATS } from "@/lib/db/schema";

const emailMessageSchema = z.object({
  type: z.literal("EMAIL"),
  data: z.object({
    to: z.string(),
    subject: z.string(),
    html: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
    idempotencyKey: z.string().optional(),
    unsubscribe: z
      .object({
        userId: z.string(),
        type: z.enum(EMAIL_UNSUBSCRIBE_TYPES),
      })
      .optional(),
  }),
});

const webhookMessageSchema = z.object({
  type: z.literal("WEBHOOK"),
  data: z.object({
    // Messages queued before providers carry only url and secret.
    ...webhookEndpointSchema.shape,
    event: notificationEventSchema,
  }),
});

const novelImportMessageSchema = z.object({
  type: z.literal("NOVEL_IMPORT"),
  data: z.object({
    novelId: z.number().int().positive(),
    fileKey: z.string(),
    format: z.enum(NOVEL_FILE_FORMATS),
  }),
});

export const queueMessageSchema = z.discriminatedUnion("type", [
  emailMessageSchema,
  webhookMessageSchema,
  novelImportMessageSchema,
]);

export type QueueMessage = z.infer<typeof queueMessageSchema>;
export type EmailMessage = z.infer<typeof emailMessageSchema>;
export type WebhookMessage = z.infer<typeof webhookMessageSchema>;
export type NovelImportMessage = z.infer<typeof novelImportMessageSchema>;
