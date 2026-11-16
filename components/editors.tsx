"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AlertCircle, ArrowRight, Check, Clock3, Trash2, X } from "lucide-react";
import { DateTime, IANAZone } from "luxon";
import { dependencyPaths } from "../lib/graph";
import { maxDuration, maxServiceTypeLength, outcomes, suggestedServiceTypes, type ImpactKind, type Job, type Mutation, type RunLog, type Service, type Workspace } from "../lib/model";
import { explainConflict, formatDate, formatTime, formatTimeSpan, parseCron, projectImpacts, type Conflict, type Occurrence } from "../lib/schedule";

export type Editor =
  | { kind: "job"; job?: Job }
  | { kind: "service"; service?: Service }
  | { kind: "settings" }
  | { kind: "run"; occurrence?: Occurrence; log?: RunLog };

type Send = (mutation: Mutation) => Promise<void>;

const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function initialSchedule(job?: Job) {
  if (!job) return { mode: "daily", time: "23:00", weekdays: [] as number[] };
  const match = job.cron.match(/^(\d+)\s+(\d+)\s+\*\s+\*\s+(\*|[0-6](?:,[0-6])*)$/);
  if (!match) return { mode: "cron", time: "23:00", weekdays: [] as number[] };
  return {
    mode: match[3] === "*" ? "daily" : "weekly",
    time: [match[2], match[1]].map((part) => part.padStart(2, "0")).join(":"),
    weekdays: match[3] === "*" ? [] : match[3].split(",").map(Number),
  };
}

function Actions({ busy, label, close, remove }: { busy: boolean; label: string; close: () => void; remove?: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="dialog-actions">
      {remove && (confirming ? (
        <button type="button" className="button danger" onClick={() => void remove()} disabled={busy}>Confirm delete</button>
      ) : (
        <button type="button" className="button ghost danger-text" onClick={() => setConfirming(true)} disabled={busy}><Trash2 size={15} /> Delete</button>
      ))}
      <div className="action-spacer" />
      <button type="button" className="button" onClick={close} disabled={busy}>Cancel</button>
      <button type="submit" className="button primary" disabled={busy}>{busy ? "Saving…" : label}</button>
    </div>
  );
}

function Issue({ error }: { error: string }) {
  return error && <p className="form-error" role="alert"><AlertCircle size={16} /> {error}</p>;
}

function Choices({ services, value, onChange, unavailable }: {
  services: Service[];
  value: string[];
  onChange: (value: string[]) => void;
  unavailable: string;
}) {
  if (!services.length) return <p className="field-hint">{unavailable}</p>;
  return (
    <div className="choice-list">
      {services.map((service) => (
        <label className="choice" key={service.id}>
          <input
            type="checkbox"
            checked={value.includes(service.id)}
            onChange={(event) => onChange(event.target.checked ? [...value, service.id] : value.filter((id) => id !== service.id))}
          />
          <span>{service.name}</span>
          <small>{service.kind}</small>
        </label>
      ))}
    </div>
  );
}

function JobForm({ job, workspace, send, close }: { job?: Job; workspace: Workspace; send: Send; close: () => void }) {
  const initial = initialSchedule(job);
  const [mode, setMode] = useState(initial.mode);
  const [time, setTime] = useState(initial.time);
  const [weekdays, setWeekdays] = useState(initial.weekdays);
  const [raw, setRaw] = useState(job?.cron ?? "0 23 * * *");
  const [requires, setRequires] = useState(job?.requires ?? []);
  const [impacts, setImpacts] = useState(job?.impacts ?? []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [hour, minute] = time.split(":").map(Number);
  const cron = mode === "cron" ? raw : `${minute} ${hour} * * ${mode === "daily" ? "*" : [...weekdays].sort().join(",")}`;
  const impactChain = projectImpacts({ impacts }, workspace.services).filter((impact) => impact.path.length > 1);
  const label = (id: string) => workspace.services.find((service) => service.id === id)?.name ?? id;

  async function attempt(mutation: Mutation) {
    setBusy(true);
    setError("");
    try {
      await send(mutation);
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "weekly" && !weekdays.length) {
      setError("Select at least one day of the week.");
      return;
    }
    try {
      parseCron(cron, workspace.timezone);
    } catch {
      setError("Enter a valid five-field cron expression.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const padding = form.get("padding");
    void attempt({
      action: "save-job",
      id: job?.id,
      value: {
        name: String(form.get("name")), cron, duration: Number(form.get("duration")),
        padding: padding === "" ? null : Number(padding), enabled: form.has("enabled"), requires, impacts,
      },
    });
  }

  return (
    <form onSubmit={submit}>
      <div className="dialog-body">
        <label className="field">Job name<input name="name" required maxLength={100} defaultValue={job?.name} placeholder="e.g. NAS snapshot" autoFocus /></label>
        <div className="form-grid">
          <label className="field">Repeat
            <select value={mode} onChange={(event) => { setMode(event.target.value); setError(""); }}>
              <option value="daily">Daily</option>
              <option value="weekly">On selected weekdays</option>
              <option value="cron">Cron expression</option>
            </select>
          </label>
          <label className="field">Duration (minutes)<input name="duration" type="number" min={1} max={maxDuration} required defaultValue={job?.duration ?? 30} /></label>
        </div>
        {mode === "cron" ? (
          <label className="field">Cron expression
            <input className="mono" required maxLength={100} value={raw} onChange={(event) => { setRaw(event.target.value); setError(""); }} />
            <span className="field-hint">Minute, hour, day of month, month, day of week · {workspace.timezone}</span>
          </label>
        ) : (
          <label className="field">Start time <span className="field-hint">{workspace.timezone}</span>
            <input type="time" required value={time} onChange={(event) => setTime(event.target.value)} />
          </label>
        )}
        {mode === "weekly" && (
          <fieldset>
            <legend>Days of the week</legend>
            <div className="weekdays">
              {days.map((text, index) => <button key={text} type="button" className="button" aria-pressed={weekdays.includes(index)} onClick={() => { setWeekdays(weekdays.includes(index) ? weekdays.filter((day) => day !== index) : [...weekdays, index]); setError(""); }}>{text}</button>)}
            </div>
          </fieldset>
        )}
        <label className="field">Overrun buffer (minutes)
          <input name="padding" type="number" min={0} max={maxDuration} defaultValue={job?.padding ?? ""} placeholder={String(workspace.padding ?? 0)} />
          <span className="field-hint">Leave blank to use the workspace default of {workspace.padding ?? 0} minutes. Enter 0 to disable the buffer for this job.</span>
        </label>
        <fieldset>
          <legend>Requires</legend>
          <p className="field-hint">This job needs these services to be available while it runs.</p>
          <Choices services={workspace.services} value={requires} onChange={setRequires} unavailable="Add a service in Services to link it here." />
        </fieldset>
        <fieldset>
          <legend>Can take offline</legend>
          <p className="field-hint">Use Conditional when an outage depends on something happening, such as an available update.</p>
          {workspace.services.length > 0 && (
            <div className="choice-list">
              {workspace.services.map((service) => (
                <label className="choice impact-choice" key={service.id}>
                  <span>{service.name}</span>
                  <select
                    aria-label={`Impact on ${service.name}`}
                    value={impacts.find((impact) => impact.serviceId === service.id)?.kind ?? ""}
                    onChange={(event) => {
                      const remaining = impacts.filter((impact) => impact.serviceId !== service.id);
                      const kind = event.target.value as ImpactKind | "";
                      setImpacts(kind ? [...remaining, { serviceId: service.id, kind }] : remaining);
                    }}
                  >
                    <option value="">No outage</option>
                    <option value="conditional">Conditional</option>
                    <option value="planned">Planned</option>
                  </select>
                </label>
              ))}
            </div>
          )}
          {impactChain.length > 0 && <div className="inferred"><span>Downstream impact</span>{impactChain.map((item) => <small key={item.serviceId}>{item.path.map(label).join(" → ")}</small>)}</div>}
        </fieldset>
        <label className="checkbox-line"><input type="checkbox" name="enabled" defaultChecked={job?.enabled ?? true} /> Include in schedule projections</label>
        <Issue error={error} />
      </div>
      <Actions busy={busy} label={job ? "Save changes" : "Create job"} close={close} remove={job ? () => attempt({ action: "delete-job", id: job.id }) : undefined} />
    </form>
  );
}

function ServiceForm({ service, workspace, send, close }: { service?: Service; workspace: Workspace; send: Send; close: () => void }) {
  const [parents, setParents] = useState(service?.dependsOn ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const excluded = new Set(service ? dependencyPaths(workspace.services, service.id, "downstream").keys() : []);
  const types = [...new Set([...suggestedServiceTypes, ...workspace.services.map((item) => item.kind)])].sort();

  async function attempt(mutation: Mutation) {
    setError("");
    setBusy(true);
    try {
      await send(mutation);
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void attempt({
      action: "save-service",
      id: service?.id,
      value: { name: String(form.get("name")), kind: String(form.get("kind")), dependsOn: parents },
    });
  }

  return (
    <form onSubmit={submit}>
      <div className="dialog-body">
        <label className="field">Service name<input name="name" required maxLength={100} defaultValue={service?.name} placeholder="e.g. Internet access" autoFocus /></label>
        <label className="field">
          <span id="service-type-label">Type</span>
          <input name="kind" list="service-types" defaultValue={service?.kind} maxLength={maxServiceTypeLength} placeholder="Service" aria-labelledby="service-type-label" aria-describedby="service-type-help" />
          <datalist id="service-types">{types.map((type) => <option key={type} value={type} />)}</datalist>
          <span className="field-hint" id="service-type-help">Choose a suggestion, enter your own type, or leave it blank to use Service.</span>
        </label>
        <fieldset>
          <legend>Depends on</legend>
          <p className="field-hint">If any selected service goes offline, this service is also affected.</p>
          <Choices services={workspace.services.filter((item) => !excluded.has(item.id))} value={parents} onChange={setParents} unavailable="There are no available upstream services." />
        </fieldset>
        <Issue error={error} />
      </div>
      <Actions busy={busy} label={service ? "Save changes" : "Create service"} close={close} remove={service ? () => attempt({ action: "delete-service", id: service.id }) : undefined} />
    </form>
  );
}

function SettingsForm({ workspace, send, close }: { workspace: Workspace; send: Send; close: () => void }) {
  const [value, setValue] = useState(workspace.timezone);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!IANAZone.isValidZone(value.trim())) {
      setError("Enter an IANA timezone such as Europe/London or America/New_York.");
      return;
    }
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try { await send({ action: "save-settings", timezone: value, padding: Number(form.get("padding")) }); }
    catch (failure) { setError((failure as Error).message); setBusy(false); }
  }

  return (
    <form onSubmit={submit}>
      <div className="dialog-body">
        <label className="field">Schedule timezone
          <input autoFocus list="timezones" value={value} onChange={(event) => { setValue(event.target.value); setError(""); }} required />
          <datalist id="timezones">{["UTC", ...Intl.supportedValuesOf("timeZone")].map((zone) => <option key={zone} value={zone} />)}</datalist>
        </label>
        <p className="field-hint">Existing cron expressions will run at their configured wall-clock times in the selected timezone.</p>
        <label className="field">Default overrun buffer (minutes)
          <input name="padding" type="number" min={0} max={maxDuration} required defaultValue={workspace.padding ?? 0} />
          <span className="field-hint">Allow this much extra time after each run when projecting outages and conflicts. Individual jobs can override this.</span>
        </label>
        <Issue error={error} />
      </div>
      <Actions busy={busy} label="Save settings" close={close} />
    </form>
  );
}

function RunForm({ occurrence, log, workspace, send, close }: { occurrence?: Occurrence; log?: RunLog; workspace: Workspace; send: Send; close: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const jobId = log?.jobId ?? occurrence!.job.id;
  const start = log?.start ?? occurrence!.start;
  const jobName = log?.jobName ?? occurrence!.job.name;
  const timezone = workspace.timezone;

  async function attempt(mutation: Mutation) {
    setBusy(true);
    try { await send(mutation); }
    catch (failure) { setError((failure as Error).message); setBusy(false); }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void attempt({ action: "log-run", jobId, start, outcome: form.get("outcome") as RunLog["outcome"], note: String(form.get("note")) });
  }

  return (
    <form onSubmit={submit}>
      <div className="dialog-body">
        <div className="run-context"><div><strong>{jobName}</strong><span className="mono">{formatDate(start, timezone)} · {formatTime(start, timezone)}</span></div><Clock3 size={18} /></div>
        <label className="field">Outcome<select name="outcome" defaultValue={log?.outcome ?? "Succeeded"} autoFocus>{outcomes.map((outcome) => <option key={outcome}>{outcome}</option>)}</select></label>
        <label className="field">Notes<textarea name="note" rows={4} maxLength={2000} defaultValue={log?.note} placeholder="Record what happened during this run." /></label>
        <Issue error={error} />
      </div>
      <Actions busy={busy} label="Save run" close={close} remove={log ? () => attempt({ action: "delete-log", jobId, start }) : undefined} />
    </form>
  );
}

export function Modal({ title, subtitle, close, children }: { title: string; subtitle?: string; close: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog ref={dialogRef} className="dialog" aria-labelledby="dialog-title" onCancel={(event) => { event.preventDefault(); close(); }}>
      <header className="dialog-head">
        <div><h2 id="dialog-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        <button className="button icon ghost" aria-label="Close dialog" onClick={close}><X size={19} /></button>
      </header>
      {children}
    </dialog>
  );
}

export function WorkspaceEditor({ editor, workspace, send, close }: { editor: Editor; workspace: Workspace; send: Send; close: () => void }) {
  if (editor.kind === "job") {
    return <Modal title={editor.job ? "Edit job" : "New job"} subtitle="Define when it runs and what it needs or takes offline." close={close}><JobForm job={editor.job} workspace={workspace} send={send} close={close} /></Modal>;
  }
  if (editor.kind === "service") {
    return <Modal title={editor.service ? "Edit service" : "New service"} subtitle="Add reusable devices and services to your dependency map." close={close}><ServiceForm service={editor.service} workspace={workspace} send={send} close={close} /></Modal>;
  }
  if (editor.kind === "settings") {
    return <Modal title="Schedule settings" close={close}><SettingsForm workspace={workspace} send={send} close={close} /></Modal>;
  }
  return <Modal title={editor.log ? "Edit run log" : "Log run"} close={close}><RunForm {...editor} workspace={workspace} send={send} close={close} /></Modal>;
}

export function OccurrenceDetails({ run, workspace, now, conflicts, close, onEdit, onLog }: {
  run: Occurrence; workspace: Workspace; now: number; conflicts: Conflict[]; close: () => void; onEdit: () => void; onLog: () => void;
}) {
  const impact = projectImpacts(run.job, workspace.services);
  const logged = workspace.logs.find((entry) => entry.jobId === run.job.id && entry.start === run.start);
  const date = DateTime.fromMillis(run.start, { zone: workspace.timezone });
  const end = DateTime.fromMillis(run.scheduledEnd, { zone: workspace.timezone });
  const names = new Map(workspace.services.map((service) => [service.id, service.name]));

  return (
    <Modal title={run.job.name} subtitle={`${date.toFormat("d LLL, HH:mm")} → ${end.toFormat(date.hasSame(end, "day") ? "HH:mm" : "d LLL, HH:mm")} · ${workspace.timezone}`} close={close}>
      <div className="dialog-body">
        <div className="detail-section"><h3>Expected status</h3><p>{now < run.start ? "Upcoming" : now < run.scheduledEnd ? "Expected to be running" : now < run.end ? "May still be running (overrun buffer)" : "Scheduled window ended"}</p>
          {run.end > run.scheduledEnd && <p>Overrun buffer until {formatDate(run.end, workspace.timezone)} at {formatTime(run.end, workspace.timezone)}</p>}
        </div>
        {!!run.job.requires.length && <div className="detail-section"><h3>Requires</h3><p>{run.job.requires.map((id) => names.get(id)).join(", ")}</p></div>}
        {!!impact.length && <div className="detail-section"><h3>Projected impact</h3>{impact.map((item) => <p key={item.serviceId}>{item.path.map((id) => names.get(id)).join(" → ")} <span className="pill">{item.kind}</span></p>)}</div>}
        {!!conflicts.length && (
          <div className="detail-section"><h3>Dependency conflicts</h3>
            {conflicts.map((conflict) => {
              const { headline, paths } = explainConflict(conflict, workspace);
              return <div className="detail-conflict" key={`${conflict.source.job.id}:${conflict.source.start}`}>
                <strong>{headline}</strong>
                <p className="mono">{formatTimeSpan(conflict.from, conflict.to, workspace.timezone)}</p>
                {paths.map((path) => <p key={path}>{path}</p>)}
                {conflict.paddingOnly && <p>Overlap only within an overrun buffer</p>}
              </div>;
            })}
          </div>
        )}
        {logged && <div className="detail-section"><h3>Logged outcome</h3><p><Check size={14} /> {logged.outcome}</p>{logged.note && <p className="preserve-lines">{logged.note}</p>}</div>}
      </div>
      <div className="dialog-actions"><button className="button" onClick={onEdit}>Edit job <ArrowRight size={15} /></button><div className="action-spacer" />{run.start <= now && <button className="button primary" onClick={onLog}>{logged ? "Edit run log" : "Log run"}</button>}</div>
    </Modal>
  );
}
