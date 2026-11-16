"use client";

import { useEffect, useMemo, useState, type MouseEvent, type FocusEvent } from "react";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, CalendarDays, CircleCheck, Clock3, Layers, Radio, Timer } from "lucide-react";
import { DateTime } from "luxon";
import { minute, type Workspace } from "../lib/model";
import { formatDate, formatTime, localDate, nextOccurrence, occurrencesFor, projectWindow, timeWindow, type Conflict, type Occurrence, type Window } from "../lib/schedule";

const ranges = [
  ["21", "Evening · 21:00–03:00"],
  ["day", "Full day"],
  ["0", "Night · 00:00–06:00"],
  ["6", "Morning · 06:00–12:00"],
  ["12", "Afternoon · 12:00–18:00"],
  ["18", "Evening · 18:00–00:00"],
];

function moveDay(date: string, days: number) {
  return DateTime.fromISO(date, { zone: "UTC" }).plus({ days }).toISODate()!;
}

function runKey(run: Occurrence) {
  return `${run.job.id}:${run.start}`;
}

function tooltipTime(run: Occurrence, timezone: string) {
  const start = DateTime.fromMillis(run.start, { zone: timezone });
  const end = DateTime.fromMillis(run.scheduledEnd, { zone: timezone });
  return `${start.toFormat("d LLL, HH:mm ZZZZ")} – ${end.toFormat(start.hasSame(end, "day") ? "HH:mm ZZZZ" : "d LLL, HH:mm ZZZZ")}`;
}

export function explainConflict(conflict: Conflict, workspace: Workspace) {
  const names = new Map(workspace.services.map((service) => [service.id, service.name]));
  return {
    headline: `${conflict.target.job.name} ${conflict.conditional ? "may lose" : "is expected to lose"} ${conflict.impacts.map((item) => names.get(item.serviceId)).join(", ")}`,
    paths: conflict.impacts.map((item) => [conflict.source.job.name, ...item.path.map((id) => names.get(id))].join(" → ")),
  };
}

function TimelineChart({ workspace, window, now, projection, onRun }: {
  workspace: Workspace;
  window: Window;
  now: number;
  projection: ReturnType<typeof projectWindow>;
  onRun: (run: Occurrence, conflicts: string[]) => void;
}) {
  const { byJob, impactByJob, conflicts } = projection;
  const activeJobs = workspace.jobs.filter((job) => (byJob.get(job.id)?.length ?? 0) > 0)
    .sort((a, b) => byJob.get(a.id)![0].start - byJob.get(b.id)![0].start);
  const length = window.to - window.from;
  const midnight = DateTime.fromMillis(window.from, { zone: workspace.timezone }).plus({ days: 1 }).startOf("day").toMillis();
  const interval = length > 8 * 60 * minute ? 3 : 1;
  const progress = (time: number) => ((time - window.from) / length) * 100;
  const ticks = Array.from({ length: Math.ceil(length / (interval * 60 * minute)) }, (_, index) => window.from + index * interval * 60 * minute);
  const targetConflicts = new Map<string, Conflict[]>();
  for (const conflict of conflicts) {
    const key = runKey(conflict.target);
    const existing = targetConflicts.get(key) ?? [];
    existing.push(conflict);
    targetConflicts.set(key, existing);
  }
  const nowVisible = now >= window.from && now < window.to;
  const [tip, setTip] = useState<{ top: number; left: number; below: boolean; time: string; buffer?: string }>();

  useEffect(() => {
    const hide = () => setTip(undefined);
    globalThis.addEventListener("scroll", hide, true);
    globalThis.addEventListener("resize", hide, true);
    return () => {
      globalThis.removeEventListener("scroll", hide, true);
      globalThis.removeEventListener("resize", hide, true);
    };
  }, []);

  function showTip(event: MouseEvent<HTMLButtonElement> | FocusEvent<HTMLButtonElement>, time: string, buffer?: string) {
    const rect = event.currentTarget.getBoundingClientRect();
    const below = rect.top < 80;
    const edge = Math.min(165, globalThis.innerWidth / 2);
    const left = Math.max(edge, Math.min(globalThis.innerWidth - edge, (rect.left + rect.right) / 2));
    setTip({ top: below ? rect.bottom + 8 : rect.top - 8, left, below, time, buffer });
  }

  if (!activeJobs.length) {
    const hasJobs = workspace.jobs.length > 0;
    return <div className="empty"><CalendarDays size={22} /><strong>{hasJobs ? "No runs in this window" : "No jobs yet"}</strong><span>{hasJobs ? "Pick a different date or time range to see more of your schedule." : "Use New job to add your first scheduled run."}</span></div>;
  }

  return (
    <>
    <div className="chart-scroll" role="region" aria-label="Maintenance timeline chart" tabIndex={0}>
      <div className="chart">
        <div className="chart-row chart-head">
          <span className="chart-label">Job</span>
          <div className="chart-track">
            {ticks.map((tick) => <span key={tick} className={`tick ${tick === midnight ? "midnight" : ""}`} style={{ left: `${progress(tick)}%` }}>{formatTime(tick, workspace.timezone)}</span>)}
          </div>
        </div>
        {activeJobs.map((job) => {
          const laneEnds: number[] = [];
          const bars = byJob.get(job.id)!.map((run) => {
            const open = laneEnds.findIndex((end) => end <= run.start);
            const lane = open === -1 ? laneEnds.length : open;
            laneEnds[lane] = run.end;
            return { run, lane };
          });
          const impacts = impactByJob.get(job.id)!;
          const defaultState = impacts.some((impact) => impact.kind === "planned") ? "planned" : impacts.length ? "conditional" : "scheduled";
          return (
            <div className="chart-row" key={job.id}>
              <span className="chart-label" title={job.name}>{job.name}</span>
              <div className="chart-track" style={{ height: `${16 + laneEnds.length * 30}px` }}>
                {ticks.map((tick) => <span aria-hidden="true" key={tick} className={`grid-line ${tick === midnight ? "midnight" : ""}`} style={{ left: `${progress(tick)}%` }} />)}
                {nowVisible && <span aria-hidden="true" className="now-line" style={{ left: `${progress(now)}%` }} />}
                {bars.map(({ run, lane }) => {
                  const hits = targetConflicts.get(runKey(run));
                  const state = hits ? "conflict" : defaultState;
                  const left = progress(Math.max(run.start, window.from));
                  const width = progress(Math.min(run.end, window.to)) - left;
                  const time = `${formatTime(run.start, workspace.timezone)}–${formatTime(run.scheduledEnd, workspace.timezone)}`;
                  const bufferFrom = progress(Math.min(window.to, Math.max(window.from, run.scheduledEnd)));
                  const bufferLeft = ((bufferFrom - left) / width) * 100;
                  const buffer = run.end > run.scheduledEnd ? `Overrun buffer until ${DateTime.fromMillis(run.end, { zone: workspace.timezone }).toFormat("d LLL, HH:mm ZZZZ")}` : undefined;
                  const fullTime = tooltipTime(run, workspace.timezone);
                  const spokenState = state === "conflict" ? "Dependency conflict" : state === "conditional" ? "Conditional outage" : state === "planned" ? "Planned outage" : "Scheduled";
                  return (
                    <button
                      key={run.start}
                      className={`run-bar ${state}`}
                      style={{ left: `${left}%`, width: `${width}%`, top: 10 + lane * 30 }}
                      aria-label={[job.name, fullTime, spokenState, buffer].filter(Boolean).join(", ")}
                      onMouseEnter={(event) => showTip(event, fullTime, buffer)}
                      onMouseLeave={() => setTip(undefined)}
                      onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) showTip(event, fullTime, buffer); }}
                      onBlur={() => setTip(undefined)}
                      onKeyDown={(event) => { if (event.key === "Escape") setTip(undefined); }}
                      onClick={() => { setTip(undefined); onRun(run, [...new Set(hits?.map((hit) => explainConflict(hit, workspace).headline))]); }}
                    >
                      {bufferLeft < 100 && <i aria-hidden="true" className="bar-buffer" style={{ left: `${bufferLeft}%` }} />}
                      {width * bufferLeft / 100 >= 9.7 && <span className="bar-label" style={{ width: `${bufferLeft}%` }}>{time}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
    <p className="chart-scroll-hint">Scroll the chart to see more hours.</p>
    {tip && <div aria-hidden="true" className={`time-tooltip ${tip.below ? "below" : ""}`} style={{ left: tip.left, top: tip.top }}><strong>{tip.time}</strong>{tip.buffer && <span>{tip.buffer}</span>}</div>}
    </>
  );
}

export function Timeline({ workspace, now, onRun }: { workspace: Workspace; now: number; onRun: (run: Occurrence, conflicts: string[]) => void }) {
  const today = localDate(now, workspace.timezone);
  const [selected, setSelected] = useState<string>();
  const [range, setRange] = useState("day");
  const [shown, setShown] = useState(8);
  const date = selected ?? today;
  const window = useMemo(() => timeWindow(date, range, workspace.timezone), [date, range, workspace.timezone]);
  const projection = useMemo(() => projectWindow(workspace, window), [workspace, window]);
  const next = useMemo(() => nextOccurrence(workspace, now), [workspace, now]);
  const currentRuns = useMemo(() => workspace.jobs.flatMap((job) =>
    occurrencesFor(job, { from: now, to: now + 1 }, workspace.timezone, workspace.padding)), [workspace, now]);
  const running = currentRuns.filter((run) => now < run.scheduledEnd);
  const overrunning = currentRuns.filter((run) => now >= run.scheduledEnd);
  const offline = new Map<string, "conditional" | "planned">();
  for (const run of currentRuns) {
    for (const item of projection.impactByJob.get(run.job.id)!) {
      const kind = now >= run.scheduledEnd ? "conditional" : item.kind;
      if (!offline.has(item.serviceId) || kind === "planned") offline.set(item.serviceId, kind);
    }
  }
  const activeNames = [...new Set(running.map((run) => run.job.name))];
  const overrunNames = [...new Set(overrunning.map((run) => run.job.name))];
  const planned = [...offline.values()].filter((kind) => kind === "planned").length;
  const conditional = offline.size - planned;

  function pickDate(value?: string) {
    setSelected(value);
    setShown(8);
  }

  return (
    <>
      <div className="page-intro">
        <div><h1>Schedule overview</h1><p>See when jobs run and what they could affect.</p></div>
      </div>
      <section className="stats" aria-label="Schedule summary">
        <div className="stat">
          <div className="stat-label"><Radio size={15} /> Expected now</div>
          <div className="stat-main"><i className={`status-dot ${currentRuns.length ? "running" : ""}`} /><strong>{running.length ? `${running.length} active ${running.length === 1 ? "run" : "runs"}` : overrunning.length ? "Possible overrun" : "No active jobs"}</strong></div>
          {!currentRuns.length && <p>Based on the schedule</p>}
          {running.length > 0 && <p>{activeNames.join(", ")}</p>}
          {overrunning.length > 0 && <p>May still be running · {overrunNames.join(", ")}</p>}
          {offline.size > 0 && <p className="now-impacts">{[planned ? `${planned} expected offline` : "", conditional ? `${conditional} possibly offline` : ""].filter(Boolean).join(" · ")}</p>}
          {offline.size > 0 && <details className="current-services"><summary>View affected services</summary><ul>{workspace.services.filter((service) => offline.has(service.id)).map((service) => <li key={service.id}>{service.name} <span>{offline.get(service.id) === "planned" ? "Expected offline" : "Possibly offline"}</span></li>)}</ul></details>}
        </div>
        <div className="stat">
          <div className="stat-label"><Clock3 size={15} /> Next up</div>
          <div className="stat-main"><strong>{next?.job.name ?? "No upcoming jobs"}</strong></div>
          {next && <p className="mono">{localDate(next.start, workspace.timezone) !== today && `${formatDate(next.start, workspace.timezone)} · `}{formatTime(next.start, workspace.timezone)}</p>}
        </div>
        <a className="stat stat-link" href="#dependency-conflicts" onClick={(event) => { event.preventDefault(); document.getElementById("dependency-conflicts")?.scrollIntoView(); }}>
          <div className="stat-label"><AlertTriangle size={15} /> Dependency conflicts <ArrowDown size={14} className="stat-arrow" /></div>
          <div className="stat-main"><strong>{projection.conflicts.length}</strong></div>
          <p>In this window</p>
        </a>
      </section>
      <section className="panel timeline-panel" aria-labelledby="timeline-title">
        <h2 id="timeline-title">Maintenance timeline</h2>
        <div className="timeline-controls">
          <div className="date-controls">
            <button className="button icon" aria-label="Previous day" onClick={() => pickDate(moveDay(date, -1))}><ArrowLeft size={16} /></button>
            <input type="date" aria-label="Timeline date" value={date} min="1970-01-01" max="9998-12-31" onChange={(event) => { if (event.target.value && event.target.validity.valid) pickDate(event.target.value); }} />
            <button className="button icon" aria-label="Next day" onClick={() => pickDate(moveDay(date, 1))}><ArrowRight size={16} /></button>
            <button className="button" onClick={() => pickDate()}>Today</button>
          </div>
          <select aria-label="Timeline range" value={range} onChange={(event) => { setRange(event.target.value); setShown(8); }}>{ranges.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        </div>
        <div className="legend">
          <span><i className="scheduled" />Scheduled</span>
          <span><i className="conditional" />Conditional impact</span>
          <span><i className="planned" />Planned outage</span>
          <span><i className="conflict" />Conflict</span>
          {workspace.jobs.some((job) => job.enabled && (job.padding ?? workspace.padding ?? 0) > 0) && <span><i className="buffer-key" />Overrun buffer</span>}
          {now >= window.from && now < window.to && <span><i className="now-key" />Now</span>}
        </div>
        <TimelineChart workspace={workspace} window={window} now={now} projection={projection} onRun={onRun} />
      </section>
      <section className="panel conflicts-panel" id="dependency-conflicts" aria-labelledby="conflicts-title">
        <h2 id="conflicts-title">Dependency conflicts</h2>
        {projection.conflicts.length ? (
          <div className="conflict-list">
            {projection.conflicts.slice(0, shown).map((item) => {
              const { headline, paths } = explainConflict(item, workspace);
              return (
                <button key={`${runKey(item.source)}:${runKey(item.target)}`} className="conflict-row" onClick={() => onRun(item.target, [headline])}>
                  <AlertTriangle size={20} />
                  <span className="conflict-copy"><strong>{headline}</strong>{paths.map((path) => <span className="mono" key={path}>{path}</span>)}{item.paddingOnly && <span>Overlap only within an overrun buffer</span>}</span>
                  <span className="conflict-time mono"><Timer size={14} /> {formatTime(item.from, workspace.timezone)}–{formatTime(item.to, workspace.timezone)}</span>
                </button>
              );
            })}
            {shown < projection.conflicts.length && <button className="button more" onClick={() => setShown(shown + 20)}>Show more conflicts</button>}
          </div>
        ) : <div className="quiet-state"><CircleCheck size={18} /> No dependency conflicts in this window.</div>}
      </section>
    </>
  );
}

export function EmptyJobs({ onCreate }: { onCreate: () => void }) {
  return <div className="empty"><Layers size={24} /><strong>No jobs yet</strong><span>Add your first scheduled job to see it on the timeline.</span><button className="button primary" onClick={onCreate}>New job</button></div>;
}
