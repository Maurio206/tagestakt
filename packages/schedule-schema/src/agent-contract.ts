/**
 * GEPLANTER Vertrag für den späteren Claude-Agent-Anschluss (siehe docs/agent-integration.md).
 *
 * Wird in dieser Phase von KEINEM Endpunkt verwendet. Das Schema liegt hier, damit
 * der spätere serverseitige Endpunkt dieselbe Validierung wie das Web-UI nutzt.
 *
 * Wichtig: Der Vertrag kennt bewusst kein Statusfeld. Ein Agent kann ausschließlich
 * Entwürfe einreichen; Veröffentlichen bleibt eine Bestätigung des Benutzers.
 */
import { z } from "zod";

import { PLANNING_NOTE_MAX_LENGTH, SCHEDULE_TIMEZONE } from "./constants";
import { scheduleEntryInputSchema, weekStartSchema } from "./schemas";

export const AGENT_CONTRACT_VERSION = 1;
export const AGENT_MAX_ENTRIES_PER_DRAFT = 300;

export const agentDraftRequestSchema = z
  .object({
    contractVersion: z.literal(AGENT_CONTRACT_VERSION),
    /** Vom Aufrufer erzeugt; wiederholte Requests mit gleichem Schlüssel sind idempotent. */
    idempotencyKey: z
      .string()
      .min(16)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
    weekStart: weekStartSchema,
    timezone: z.literal(SCHEDULE_TIMEZONE),
    planningNote: z.string().trim().max(PLANNING_NOTE_MAX_LENGTH).nullish(),
    entries: z.array(scheduleEntryInputSchema).min(1).max(AGENT_MAX_ENTRIES_PER_DRAFT),
  })
  .strict();

export type AgentDraftRequest = z.input<typeof agentDraftRequestSchema>;

export const agentDraftResponseSchema = z.object({
  contractVersion: z.literal(AGENT_CONTRACT_VERSION),
  scheduleWeekId: z.guid(),
  weekStart: weekStartSchema,
  version: z.number().int().positive(),
  status: z.literal("draft"),
  entryCount: z.number().int().min(0),
  overlapWarnings: z.number().int().min(0),
  /** true, wenn derselbe idempotencyKey bereits verarbeitet wurde. */
  replayed: z.boolean(),
});

export type AgentDraftResponse = z.infer<typeof agentDraftResponseSchema>;
