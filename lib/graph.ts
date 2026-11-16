import type { Service } from "./model";

export function dependencyPaths(services: Service[], startingAt: string, direction: "upstream" | "downstream") {
  const neighbors = new Map<string, string[]>(services.map((service) => [service.id, []]));
  for (const service of services) {
    for (const upstream of service.dependsOn) {
      if (direction === "downstream") neighbors.get(upstream)?.push(service.id);
      else neighbors.get(service.id)?.push(upstream);
    }
  }

  const paths = new Map<string, string[]>([[startingAt, [startingAt]]]);
  const queue = [startingAt];
  for (const current of queue) {
    for (const next of neighbors.get(current) ?? []) {
      if (paths.has(next)) continue;
      paths.set(next, [...paths.get(current)!, next]);
      queue.push(next);
    }
  }
  return paths;
}
