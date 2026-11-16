"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, Clock3, Globe, Layers, Monitor, Moon, Plus, Server, Settings2, Sun, Terminal } from "lucide-react";
import type { Mutation, Workspace } from "../lib/model";
import type { Occurrence } from "../lib/schedule";
import { OccurrenceDetails, WorkspaceEditor, type Editor } from "./editors";
import { Timeline } from "./timeline";
import { Jobs, RunLogView, Services } from "./workspace-views";

const navigation = [
  { id: "timeline", label: "Timeline", heading: "Schedule", icon: CalendarDays },
  { id: "jobs", label: "Jobs", heading: "Jobs", icon: Layers },
  { id: "services", label: "Services", heading: "Services", icon: Server },
  { id: "run-log", label: "Run log", heading: "Run log", icon: Terminal },
] as const;

type View = (typeof navigation)[number]["id"];
type Theme = "system" | "light" | "dark";
const themes = [
  { value: "system", label: "System theme", icon: Monitor },
  { value: "light", label: "Light theme", icon: Sun },
  { value: "dark", label: "Dark theme", icon: Moon },
] as const;

function ThemePicker({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const CurrentIcon = themes.find((item) => item.value === theme)!.icon;

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (menu.current?.open && !menu.current.contains(event.target as Node)) menu.current.open = false;
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);

  return (
    <>
      <div className="theme-picker" role="group" aria-label="Color theme">
        {themes.map(({ value, label, icon: Icon }) => <button type="button" key={value} aria-label={label} aria-pressed={theme === value} title={label} onClick={() => onChange(value)}><Icon size={16} /></button>)}
      </div>
      <details className="theme-compact" ref={menu} onKeyDown={(event) => {
        if (event.key === "Escape" && menu.current?.open) {
          menu.current.open = false;
          trigger.current?.focus();
        }
      }}>
        <summary ref={trigger} aria-label="Appearance" title="Appearance"><CurrentIcon size={19} /><span>Appearance</span></summary>
        <div className="theme-options" role="group" aria-label="Color theme">
          {themes.map(({ value, label, icon: Icon }) => (
            <button key={value} type="button" aria-pressed={theme === value} onClick={() => {
              onChange(value);
              if (menu.current) menu.current.open = false;
              trigger.current?.focus();
            }}><Icon size={16} /> {label}{theme === value && <Check size={15} className="theme-check" />}</button>
          ))}
        </div>
      </details>
    </>
  );
}

export function Dashboard({ initialWorkspace, initialNow }: { initialWorkspace: Workspace; initialNow: number }) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [tab, setTab] = useState<View>("timeline");
  const [theme, setTheme] = useState<Theme>("system");
  const [now, setNow] = useState(initialNow);
  const [editor, setEditor] = useState<Editor>();
  const [details, setDetails] = useState<{ run: Occurrence; conflicts: string[] }>();

  useEffect(() => {
    const readHash = () => {
      const id = window.location.hash.slice(1);
      setTab(navigation.find((item) => item.id === id)?.id ?? "timeline");
    };
    const updateClock = () => setNow(Date.now());
    setTheme((document.documentElement.dataset.theme as Theme | undefined) ?? "system");
    readHash();
    updateClock();
    window.addEventListener("hashchange", readHash);
    window.addEventListener("focus", updateClock);
    const timer = window.setInterval(updateClock, 15_000);
    return () => {
      window.removeEventListener("hashchange", readHash);
      window.removeEventListener("focus", updateClock);
      window.clearInterval(timer);
    };
  }, []);

  function navigate(view: View) {
    setTab(view);
    window.scrollTo(0, 0);
  }

  function changeTheme(value: Theme) {
    setTheme(value);
    if (value === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
    try { localStorage.setItem("wen-theme", value); } catch {}
  }

  const open = (item: Editor) => {
    setDetails(undefined);
    setEditor(item);
  };

  async function send(mutation: Mutation) {
    const response = await fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mutation),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "The workspace could not be saved.");
    setWorkspace(result);
    setEditor(undefined);
  }

  const active = navigation.find((item) => item.id === tab)!;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#timeline" onClick={() => navigate("timeline")}>
          <span className="brand-mark"><Clock3 size={26} strokeWidth={1.9} /></span>
          <strong>Wen</strong>
        </a>
        <nav className="nav" aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) => <a key={id} href={`#${id}`} aria-current={tab === id ? "page" : undefined} onClick={() => navigate(id)}><Icon size={19} strokeWidth={1.8} />{label}</a>)}
        </nav>
        <div className="sidebar-footer">
          <button className="settings-link" aria-label={`Schedule settings, timezone ${workspace.timezone}`} title="Schedule settings" onClick={() => open({ kind: "settings" })}>
            <Globe size={17} /><span>{workspace.timezone}</span><Settings2 size={15} className="settings-icon" />
          </button>
          <ThemePicker theme={theme} onChange={changeTheme} />
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="topbar-title">{active.heading}</span>
          <button className="button primary" onClick={() => open(tab === "services" ? { kind: "service" } : { kind: "job" })}><Plus size={17} /> {tab === "services" ? "New service" : "New job"}</button>
        </header>
        <main className="content">
          <div hidden={tab !== "timeline"}>
            <Timeline workspace={workspace} now={now} onRun={(run, conflicts) => setDetails({ run, conflicts })} />
          </div>
          {tab === "jobs" && <Jobs workspace={workspace} open={open} />}
          {tab === "services" && <Services workspace={workspace} open={open} />}
          {tab === "run-log" && <RunLogView workspace={workspace} now={now} open={open} />}
        </main>
      </div>
      {editor && <WorkspaceEditor editor={editor} workspace={workspace} send={send} close={() => setEditor(undefined)} />}
      {details && <OccurrenceDetails
        {...details}
        workspace={workspace}
        now={now}
        close={() => setDetails(undefined)}
        onEdit={() => open({ kind: "job", job: details.run.job })}
        onLog={() => open({ kind: "run", occurrence: details.run, log: workspace.logs.find((log) => log.jobId === details.run.job.id && log.start === details.run.start) })}
      />}
    </div>
  );
}
