import { z } from "zod";

export const suggestedServiceTypes = ["Application", "Database", "Device", "External service", "Network", "Storage"] as const;
export const maxServiceTypeLength = 60;
export const outcomes = ["Succeeded", "Failed", "Skipped"] as const;
export const maxDuration = 1440;
export const minute = 60_000;

const id = z.string().min(1).max(100);
const name = z.string().trim().min(1, "Enter a name.").max(100);
const links = z.array(id).max(200).transform((items) => [...new Set(items)]);

const serviceFields = z.object({
  name,
  kind: z.string().trim().max(maxServiceTypeLength).transform((type) => type || "Service"),
  dependsOn: links,
});

const jobFields = z.object({
  name,
  cron: z.string().trim().min(1, "Enter a cron expression.").max(100),
  duration: z.number().int().min(1).max(maxDuration),
  padding: z.number().int().min(0).max(maxDuration).nullable().optional(),
  requires: links,
  impacts: z.array(z.object({ serviceId: id, kind: z.enum(["planned", "conditional"]) })).max(200),
  enabled: z.boolean(),
});

export type Service = z.infer<typeof serviceFields> & { id: string };
export type Job = z.infer<typeof jobFields> & { id: string };
export type ImpactKind = Job["impacts"][number]["kind"];
export type Outcome = (typeof outcomes)[number];

export type RunLog = {
  jobId: string;
  jobName: string;
  start: number;
  outcome: Outcome;
  note: string;
  loggedAt: number;
};

export type Workspace = {
  timezone: string;
  padding?: number;
  jobs: Job[];
  services: Service[];
  logs: RunLog[];
};

const start = z.number().int().min(0).max(8_640_000_000_000_000);
export const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save-job"), id: id.optional(), value: jobFields }),
  z.object({ action: z.literal("delete-job"), id }),
  z.object({ action: z.literal("save-service"), id: id.optional(), value: serviceFields }),
  z.object({ action: z.literal("delete-service"), id }),
  z.object({
    action: z.literal("save-settings"),
    timezone: z.string().trim().min(1).max(100),
    padding: z.number().int().min(0).max(maxDuration),
  }),
  z.object({
    action: z.literal("log-run"),
    jobId: id,
    start,
    outcome: z.enum(outcomes),
    note: z.string().trim().max(2000),
  }),
  z.object({ action: z.literal("delete-log"), jobId: id, start }),
]);

export type Mutation = z.input<typeof mutationSchema>;
