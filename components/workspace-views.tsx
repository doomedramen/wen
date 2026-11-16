"use client";

import { useMemo, useState } from "react";
import { ArrowRight, ChevronRight, CircleCheck, Cloud, Database, GitBranch, HardDrive, Network, Pencil, Plus, Server, Terminal, Zap, type LucideIcon } from "lucide-react";
import { dependencyPaths } from "../lib/graph";
import type { Job, Service, Workspace } from "../lib/model";
import { formatDate, formatTime, jobPadding, previousRuns, projectImpacts } from "../lib/schedule";
import type { Editor } from "./editors";
import { EmptyJobs } from "./timeline";

type OpenEditor = (editor: Editor) => void;

export function Jobs({ workspace, open }: { workspace: Workspace; open: OpenEditor }) {
  const names = new Map(workspace.services.map((service) => [service.id, service.name]));
  return (
    <>
      <div className="page-intro"><div><h1>Scheduled jobs</h1><p>Manage run times, service requirements, and expected outages.</p></div><span className="pill">{workspace.jobs.length} jobs</span></div>
      <section className="panel collection" aria-label="Scheduled jobs">
        {workspace.jobs.length ? workspace.jobs.map((job) => {
          const impacted = projectImpacts(job, workspace.services);
          const buffer = jobPadding(job, workspace.padding);
          return (
            <button className="collection-row" key={job.id} onClick={() => open({ kind: "job", job })}>
              <div className="collection-name"><div><strong>{job.name}</strong>{!job.enabled && <span className="pill">Paused</span>}</div><span className="mono">{job.cron}</span></div>
              <div className="collection-info"><span>{job.duration} min{buffer > 0 && ` + ${buffer} min buffer`}</span><span>{impacted.length ? `${impacted.length} affected ${impacted.length === 1 ? "service" : "services"}` : job.requires.length ? `Requires ${job.requires.map((id) => names.get(id)).join(", ")}` : "No service links"}</span></div>
              <ChevronRight size={17} />
            </button>
          );
        }) : <EmptyJobs onCreate={() => open({ kind: "job" })} />}
      </section>
    </>
  );
}

const serviceIcons = new Map<string, LucideIcon>([
  ["network", Network],
  ["storage", HardDrive],
  ["compute", Server],
  ["power", Zap],
  ["database", Database],
]);

export function Services({ workspace, open }: { workspace: Workspace; open: OpenEditor }) {
  const [selected, select] = useState("");
  const current = workspace.services.find((service) => service.id === selected) ?? workspace.services[0];

  return (
    <>
      <div className="page-intro"><div><h1>Services</h1><p>Link devices and services to see how outages propagate across your lab.</p></div><span className="pill">{workspace.services.length} services</span></div>
      {current ? (
        <div className="services-layout">
          <section className="panel collection" aria-label="Services inventory">
            {workspace.services.map((service) => {
              const Icon = serviceIcons.get(service.kind.toLowerCase()) ?? Cloud;
              return <button className="collection-row service-row" aria-pressed={service.id === current.id} key={service.id} onClick={() => select(service.id)}>
                <span className="item-icon"><Icon size={18} /></span>
                <span className="collection-name"><strong>{service.name}</strong><span>{service.kind}</span></span>
                <ChevronRight size={17} />
              </button>;
            })}
          </section>
          <ServiceDetails service={current} workspace={workspace} edit={() => open({ kind: "service", service: current })} select={select} />
        </div>
      ) : (
        <div className="panel"><div className="empty"><Server size={24} /><strong>No services yet</strong><span>Add a device or service to build your dependency map.</span><button className="button primary" onClick={() => open({ kind: "service" })}><Plus size={16} /> New service</button></div></div>
      )}
    </>
  );
}

function ServiceDetails({ service, workspace, edit, select }: { service: Service; workspace: Workspace; edit: () => void; select: (id: string) => void }) {
  const names = new Map(workspace.services.map((item) => [item.id, item.name]));
  const downstream = [...dependencyPaths(workspace.services, service.id, "downstream")].filter(([id]) => id !== service.id);
  const jobs = workspace.jobs.filter((job) => job.requires.includes(service.id) || projectImpacts(job, workspace.services).some((impact) => impact.serviceId === service.id));

  return (
    <section className="panel service-details">
      <header><div><h2>{service.name}</h2><p>{service.kind}</p></div><button className="button" onClick={edit}><Pencil size={14} /> Edit service</button></header>
      <div className="link-section">
        <h3><GitBranch size={16} /> Depends on</h3>
        {service.dependsOn.length ? service.dependsOn.map((id) => <button className="dependency-link" key={id} onClick={() => select(id)}>{names.get(id)} <ArrowRight size={15} /></button>) : <p>No upstream services.</p>}
      </div>
      <div className="link-section">
        <h3><GitBranch size={16} /> Affected downstream</h3>
        {downstream.length ? downstream.map(([id, path]) => <button className="dependency-link" key={id} onClick={() => select(id)}>{path.map((part) => names.get(part)).join(" → ")} <ArrowRight size={15} /></button>) : <p>No downstream services.</p>}
      </div>
      <div className="link-section">
        <h3><Terminal size={16} /> Linked jobs</h3>
        {jobs.length ? jobs.map((job) => <p key={job.id}>{job.name}{!job.enabled && " (paused)"}</p>) : <p>No linked jobs.</p>}
      </div>
    </section>
  );
}

export function RunLogView({ workspace, now, open }: { workspace: Workspace; now: number; open: OpenEditor }) {
  const [mode, setMode] = useState<"logged" | "recent">("logged");
  const recent = useMemo(() => mode === "recent" ? previousRuns(workspace, now) : [], [mode, workspace, now]);
  const logs = [...workspace.logs].sort((a, b) => b.start - a.start);
  const key = (jobId: Job["id"], start: number) => `${jobId}:${start}`;
  const entries = new Map(logs.map((log) => [key(log.jobId, log.start), log]));
  const runs = mode === "logged" ? logs.map((log) => ({ jobId: log.jobId, jobName: log.jobName, start: log.start, log, occurrence: undefined }))
    : recent.map((run) => ({ jobId: run.job.id, jobName: run.job.name, start: run.start, log: entries.get(key(run.job.id, run.start)), occurrence: run }));

  return (
    <>
      <div className="page-intro"><div><h1>Run log</h1><p>Record what happened during a scheduled run.</p></div></div>
      <div className="segmented" aria-label="Run log filter"><button aria-pressed={mode === "logged"} onClick={() => setMode("logged")}>Recorded</button><button aria-pressed={mode === "recent"} onClick={() => setMode("recent")}>Recent scheduled runs</button></div>
      <section className="panel collection" aria-label="Run log entries">
        {runs.length ? runs.map((run) => (
          <button className="collection-row log-row" key={key(run.jobId, run.start)} onClick={() => open({ kind: "run", log: run.log, occurrence: run.occurrence })}>
            <span className="collection-name"><strong>{run.jobName}</strong><span className="mono">{formatDate(run.start, workspace.timezone)} · {formatTime(run.start, workspace.timezone)}</span>{run.log?.note && <span className="log-note">{run.log.note}</span>}</span>
            <span className={`pill ${run.log?.outcome === "Failed" ? "danger-text" : ""}`}>{run.log?.outcome ?? "Log run"}</span>
            {run.log?.outcome === "Succeeded" ? <CircleCheck size={17} /> : <ChevronRight size={17} />}
          </button>
        )) : (
          <div className="empty"><Terminal size={24} /><strong>{mode === "logged" ? "No runs recorded yet" : "No recently scheduled runs"}</strong>
            <span>{mode === "logged" ? "Choose a recent occurrence or open an earlier run on the timeline." : "Runs from enabled jobs will appear here after their scheduled start."}</span>
            {mode === "logged" && <button className="button" onClick={() => setMode("recent")}>Browse recent runs <ArrowRight size={15} /></button>}
          </div>
        )}
      </section>
    </>
  );
}
