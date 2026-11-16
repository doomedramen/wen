import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { IANAZone } from "luxon";
import { dependencyPaths } from "./graph";
import { mutationSchema, type Workspace } from "./model";
import { parseCron, validOccurrenceStart } from "./schedule";

export class WorkspaceError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

const dataDirectory = process.env.WEN_DATA_DIR || join(process.cwd(), "data");
const dataFile = join(dataDirectory, "workspace.json");
let pendingWrite: Promise<unknown> = Promise.resolve();

export async function readWorkspace(): Promise<Workspace> {
  try {
    return JSON.parse(await readFile(dataFile, "utf8")) as Workspace;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const timezone = process.env.WEN_TIMEZONE || "Europe/London";
    if (!IANAZone.isValidZone(timezone)) throw new Error("WEN_TIMEZONE must be a valid IANA timezone.");
    return { timezone, jobs: [], services: [], logs: [] };
  }
}

function validateServices(workspace: Workspace, ids: string[]) {
  const known = new Set(workspace.services.map((service) => service.id));
  if (ids.some((id) => !known.has(id))) throw new WorkspaceError("A selected service no longer exists.", 409);
}

function applyMutation(workspace: Workspace, input: unknown) {
  const parsed = mutationSchema.safeParse(input);
  if (!parsed.success) throw new WorkspaceError(parsed.error.issues[0].message);

  const mutation = parsed.data;
  switch (mutation.action) {
    case "save-job": {
      const { id, value } = mutation;
      try {
        parseCron(value.cron, workspace.timezone);
      } catch {
        throw new WorkspaceError("Enter a valid five-field cron expression, such as 0 23 * * *.");
      }
      const uniqueImpacts = new Set(value.impacts.map((impact) => impact.serviceId));
      if (uniqueImpacts.size !== value.impacts.length) throw new WorkspaceError("Choose one impact per service.");
      validateServices(workspace, [...value.requires, ...uniqueImpacts]);
      const index = workspace.jobs.findIndex((job) => job.id === id);
      if (id && index < 0) throw new WorkspaceError("This job no longer exists.", 404);
      const job = { ...value, id: id ?? randomUUID() };
      if (index < 0) workspace.jobs.push(job);
      else workspace.jobs[index] = job;
      break;
    }
    case "delete-job":
      workspace.jobs = workspace.jobs.filter((job) => job.id !== mutation.id);
      break;
    case "save-service": {
      const { id, value } = mutation;
      validateServices(workspace, value.dependsOn);
      const index = workspace.services.findIndex((service) => service.id === id);
      if (id && index < 0) throw new WorkspaceError("This service no longer exists.", 404);
      if (id) {
        const downstream = dependencyPaths(workspace.services, id, "downstream");
        if (value.dependsOn.some((parent) => downstream.has(parent))) {
          throw new WorkspaceError("That link would create a dependency cycle.");
        }
      }
      const service = { ...value, id: id ?? randomUUID() };
      if (index < 0) workspace.services.push(service);
      else workspace.services[index] = service;
      break;
    }
    case "delete-service": {
      const { id } = mutation;
      if (workspace.services.some((service) => service.dependsOn.includes(id))
        || workspace.jobs.some((job) => job.requires.includes(id) || job.impacts.some((impact) => impact.serviceId === id))) {
        throw new WorkspaceError("Remove this service from linked services and jobs before deleting it.", 409);
      }
      workspace.services = workspace.services.filter((service) => service.id !== id);
      break;
    }
    case "save-settings":
      if (!IANAZone.isValidZone(mutation.timezone)) throw new WorkspaceError("Enter a valid IANA timezone.");
      workspace.timezone = mutation.timezone;
      workspace.padding = mutation.padding;
      break;
    case "log-run": {
      const { jobId, start, outcome, note } = mutation;
      const index = workspace.logs.findIndex((log) => log.jobId === jobId && log.start === start);
      const job = workspace.jobs.find((job) => job.id === jobId);
      const existing = workspace.logs[index];
      if (!existing && (!job || start > Date.now() || !validOccurrenceStart(job, start, workspace.timezone))) {
        throw new WorkspaceError("Choose a scheduled occurrence that has started.");
      }
      const log = { jobId, start, jobName: existing?.jobName ?? job!.name, outcome, note, loggedAt: Date.now() };
      if (existing) workspace.logs[index] = log;
      else workspace.logs.push(log);
      break;
    }
    case "delete-log":
      workspace.logs = workspace.logs.filter((log) => log.jobId !== mutation.jobId || log.start !== mutation.start);
      break;
  }
}

export function mutateWorkspace(input: unknown): Promise<Workspace> {
  const write = pendingWrite.then(async () => {
    const workspace = await readWorkspace();
    applyMutation(workspace, input);
    await mkdir(dataDirectory, { recursive: true });
    const temporary = join(dataDirectory, `workspace-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(workspace, null, 2) + "\n", { mode: 0o600 });
      await rename(temporary, dataFile);
    } finally {
      await rm(temporary, { force: true });
    }
    return workspace;
  });

  pendingWrite = write.catch(() => {});
  return write;
}
