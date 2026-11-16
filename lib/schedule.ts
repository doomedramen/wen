import { CronExpressionParser } from "cron-parser";
import { DateTime } from "luxon";
import { dependencyPaths } from "./graph";
import { maxDuration, minute, type ImpactKind, type Job, type Workspace } from "./model";

export type Window = { from: number; to: number };
export type Occurrence = { job: Job; start: number; scheduledEnd: number; end: number };
export type ProjectedImpact = { serviceId: string; kind: ImpactKind; path: string[] };
export type Conflict = {
  source: Occurrence;
  target: Occurrence;
  impacts: ProjectedImpact[];
  from: number;
  to: number;
  conditional: boolean;
  paddingOnly: boolean;
};

export function parseCron(cron: string, timezone: string, after?: number) {
  if (cron.trim().split(/\s+/).length !== 5 || /\bH\b/i.test(cron)) {
    throw new Error("Use five cron fields: minute, hour, day of month, month, day of week.");
  }
  return CronExpressionParser.parse(cron, { tz: timezone, currentDate: after });
}

export function localDate(time: number, timezone: string) {
  return DateTime.fromMillis(time, { zone: timezone }).toISODate()!;
}

export function timeWindow(date: string, range: string, timezone: string): Window {
  const day = DateTime.fromISO(date, { zone: timezone }).startOf("day");
  if (range === "day") return { from: day.toMillis(), to: day.plus({ days: 1 }).toMillis() };
  const startHour = Number(range);
  const endHour = startHour + 6;
  const from = day.set({ hour: startHour });
  const to = day.plus({ days: Math.floor(endHour / 24) }).set({ hour: endHour % 24 });
  return { from: from.toMillis(), to: to.toMillis() };
}

export function formatTime(time: number, timezone: string) {
  return DateTime.fromMillis(time, { zone: timezone }).toFormat("HH:mm");
}

export function formatDate(time: number, timezone: string) {
  return DateTime.fromMillis(time, { zone: timezone }).setLocale("en-GB").toFormat("d LLL yyyy");
}

export function jobPadding(job: Job, defaultPadding = 0) {
  return job.padding ?? defaultPadding;
}

function makeOccurrence(job: Job, start: number, defaultPadding: number): Occurrence {
  const scheduledEnd = start + job.duration * minute;
  return { job, start, scheduledEnd, end: scheduledEnd + jobPadding(job, defaultPadding) * minute };
}

export function occurrencesFor(job: Job, window: Window, timezone: string, defaultPadding = 0): Occurrence[] {
  if (!job.enabled) return [];
  const duration = (job.duration + jobPadding(job, defaultPadding)) * minute;
  const iterator = parseCron(job.cron, timezone, window.from - duration);
  const occurrences: Occurrence[] = [];
  while (iterator.hasNext()) {
    const start = iterator.next().getTime();
    if (start >= window.to) break;
    if (start + duration > window.from) occurrences.push(makeOccurrence(job, start, defaultPadding));
  }
  return occurrences;
}

export function nextOccurrence(workspace: Workspace, now: number): Occurrence | undefined {
  let next: Occurrence | undefined;
  for (const job of workspace.jobs) {
    if (!job.enabled) continue;
    const iterator = parseCron(job.cron, workspace.timezone, now);
    if (!iterator.hasNext()) continue;
    const start = iterator.next().getTime();
    if (!next || start < next.start) next = makeOccurrence(job, start, workspace.padding ?? 0);
  }
  return next;
}

export function projectImpacts(job: Pick<Job, "impacts">, services: Workspace["services"]): ProjectedImpact[] {
  const impacts = new Map<string, ProjectedImpact>();
  for (const direct of job.impacts) {
    for (const [serviceId, path] of dependencyPaths(services, direct.serviceId, "downstream")) {
      const existing = impacts.get(serviceId);
      if (
        !existing ||
        (existing.kind === "conditional" && direct.kind === "planned") ||
        (existing.kind === direct.kind && path.length < existing.path.length)
      ) {
        impacts.set(serviceId, { serviceId, path, kind: direct.kind });
      }
    }
  }
  return [...impacts.values()];
}

export function projectWindow(workspace: Workspace, window: Window) {
  const { jobs, services, timezone } = workspace;
  const byJob = new Map(jobs.map((job) => [job.id, occurrencesFor(job, window, timezone, workspace.padding)]));
  const impactByJob = new Map(jobs.map((job) => [job.id, projectImpacts(job, services)]));
  const conflicts: Conflict[] = [];

  for (const target of jobs) {
    if (!target.requires.length || !byJob.get(target.id)?.length) continue;
    const required = new Set(target.requires);
    for (const source of jobs) {
      const impacts = impactByJob.get(source.id)!.filter((impact) => required.has(impact.serviceId));
      if (!impacts.length) continue;

      const sourceRuns = byJob.get(source.id)!;
      let firstCandidate = 0;
      for (const targetRun of byJob.get(target.id)!) {
        while (firstCandidate < sourceRuns.length && sourceRuns[firstCandidate].end <= targetRun.start) {
          firstCandidate++;
        }
        for (let i = firstCandidate; i < sourceRuns.length; i++) {
          const sourceRun = sourceRuns[i];
          if (sourceRun.start >= targetRun.end) break;
          if (sourceRun === targetRun) continue;
          const from = Math.max(sourceRun.start, targetRun.start, window.from);
          const to = Math.min(sourceRun.end, targetRun.end, window.to);
          if (from >= to) continue;
          const paddingOnly = from >= Math.min(sourceRun.scheduledEnd, targetRun.scheduledEnd);
          conflicts.push({
            source: sourceRun,
            target: targetRun,
            impacts,
            from,
            to,
            paddingOnly,
            conditional: paddingOnly || impacts.every((impact) => impact.kind === "conditional"),
          });
        }
      }
    }
  }

  conflicts.sort((a, b) => a.from - b.from);
  return { byJob, impactByJob, conflicts };
}

export function validOccurrenceStart(job: Job, start: number, timezone: string) {
  if (start % minute !== 0 || !DateTime.fromMillis(start, { zone: timezone }).isValid) return false;
  const iterator = parseCron(job.cron, timezone, start - 1);
  return iterator.hasNext() && iterator.next().getTime() === start;
}

export function previousRuns(workspace: Workspace, now: number): Occurrence[] {
  const { jobs, timezone, padding = 0 } = workspace;
  const after = now - 30 * maxDuration * minute;
  return jobs.filter((job) => job.enabled).flatMap((job) => {
    const iterator = parseCron(job.cron, timezone, now + 1);
    const recent: Occurrence[] = [];
    while (recent.length < 5 && iterator.hasPrev()) {
      const start = iterator.prev().getTime();
      if (start < after) break;
      recent.push(makeOccurrence(job, start, padding));
    }
    return recent;
  }).sort((a, b) => b.start - a.start).slice(0, 50);
}
