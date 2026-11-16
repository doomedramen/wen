import assert from "node:assert/strict";
import { test } from "node:test";
import { minute, type Workspace } from "./model";
import { occurrencesFor, parseCron, projectWindow, timeWindow, validOccurrenceStart } from "./schedule";

const timezone = "Europe/London";
const evening = timeWindow("2026-11-16", "21", timezone);
const midnight = Date.parse("2026-11-17T00:00:00Z");

function exampleWorkspace(): Workspace {
  return {
    timezone,
    services: [
      { id: "udm", name: "UDM Pro", kind: "Network", dependsOn: [] },
      { id: "internet", name: "Internet access", kind: "Network", dependsOn: ["udm"] },
      { id: "nas", name: "NAS", kind: "Storage", dependsOn: [] },
      { id: "proxmox", name: "Proxmox", kind: "Compute", dependsOn: [] },
    ],
    jobs: [
      { id: "snapshot", name: "NAS snapshot", cron: "15 22 * * *", duration: 35, requires: ["nas"], impacts: [], enabled: true },
      {
        id: "unifi", name: "UniFi update check", cron: "0 23 * * *", duration: 70, requires: [], enabled: true,
        impacts: [{ serviceId: "udm", kind: "conditional" }],
      },
      { id: "patch", name: "Proxmox updates", cron: "20 23 * * *", duration: 100, requires: ["internet", "proxmox"], impacts: [], enabled: true },
    ],
    logs: [],
  };
}

test("UniFi impact reaches Proxmox through the gateway and internet service across midnight", () => {
  const workspace = exampleWorkspace();
  const projection = projectWindow(workspace, evening);
  assert.equal(projection.conflicts.length, 1);
  const [conflict] = projection.conflicts;
  assert.equal(conflict.source.job.id, "unifi");
  assert.equal(conflict.target.job.id, "patch");
  assert.deepEqual(conflict.impacts[0].path, ["udm", "internet"]);
  assert.equal(conflict.from, midnight - 40 * minute);
  assert.equal(conflict.to, midnight + 10 * minute);
  assert.equal(conflict.conditional, true);
});

test("padding can create a possible conflict and a zero job override removes it", () => {
  const workspace = exampleWorkspace();
  const unifi = workspace.jobs.find((job) => job.id === "unifi")!;
  unifi.duration = 20;
  unifi.impacts = [{ serviceId: "udm", kind: "planned" }];
  assert.equal(projectWindow(workspace, evening).conflicts.length, 0);

  workspace.padding = 15;
  const [conflict] = projectWindow(workspace, evening).conflicts;
  assert.equal(conflict.paddingOnly, true);
  assert.equal(conflict.conditional, true);
  assert.equal(conflict.to - conflict.from, 15 * minute);

  unifi.padding = 0;
  assert.equal(projectWindow(workspace, evening).conflicts.length, 0);
  unifi.padding = 4;
  assert.equal(projectWindow(workspace, evening).conflicts[0].to - conflict.from, 4 * minute);
});

test("day views include buffered runs carried over from the previous day", () => {
  const workspace = exampleWorkspace();
  const unifi = workspace.jobs.find((job) => job.id === "unifi")!;
  unifi.duration = 50;
  const day = timeWindow("2026-11-17", "day", timezone);
  assert.equal(occurrencesFor(unifi, day, timezone)[0].start, midnight + 23 * 60 * minute);
  const [carried] = occurrencesFor(unifi, day, timezone, 30);
  assert.equal(carried.start, midnight - 60 * minute);
  assert.equal(carried.scheduledEnd, midnight - 10 * minute);
  assert.equal(carried.end, midnight + 20 * minute);
});

test("paused jobs have no occurrences and a run log must match its cron start", () => {
  const workspace = exampleWorkspace();
  const [job] = workspace.jobs;
  assert.ok(validOccurrenceStart(job, Date.parse("2026-11-16T22:15:00Z"), timezone));
  assert.ok(!validOccurrenceStart(job, Date.parse("2026-11-16T22:15:02Z"), timezone));
  job.enabled = false;
  assert.deepEqual(occurrencesFor(job, evening, timezone), []);
});

test("five-field cron supports weekday aliases and rejects nondeterministic hashing", () => {
  assert.doesNotThrow(() => parseCron("15 22 * * THU", timezone));
  assert.throws(() => parseCron("H 22 * * *", timezone));
  assert.throws(() => parseCron("0 15 22 * * *", timezone));
});

test("full-day windows follow the local date across clock changes", () => {
  const spring = timeWindow("2026-03-29", "day", timezone);
  const fall = timeWindow("2026-10-25", "day", timezone);
  assert.equal((spring.to - spring.from) / minute, 23 * 60);
  assert.equal((fall.to - fall.from) / minute, 25 * 60);
});
