# Wen

Wen is a self-hosted scheduler for home labs. It projects when your scheduled jobs will run, what devices or services they could take offline, and which other jobs could lose a dependency. Record outcomes and notes in the run log.

## Run with Docker Compose

Start the published image, `ghcr.io/doomedramen/wen:latest`, with `compose.yaml`. Sign in to GHCR first if the package is private.

```sh
docker compose pull
docker compose up -d
```

Open <http://localhost:3000>. The app has no authentication and is intended for a trusted LAN. The `wen-data` volume stores jobs, services, schedule settings, and run logs. Keep one app instance per volume and back up the volume to preserve your workspace.

To test a build from your checkout, set `WEN_IMAGE` to its local tag.

```sh
docker build -t wen:local .
WEN_IMAGE=wen:local docker compose up -d --pull never
```

Set `WEN_PORT` to change the host port. New workspaces start empty and use `WEN_TIMEZONE`, which defaults to `Europe/London`.

## Track maintenance

1. Add your devices and services under **Services**. Pick a suggested type or enter your own. On Internet access, select UDM Pro under **Depends on**.
2. Add a job with **New job**. Pick Daily, selected weekdays, or enter five-field cron in the workspace timezone. Set the expected duration, choose required services, and mark each service the job could take offline as Planned or Conditional.
3. Check the **Timeline** for overlapping windows. A conflict identifies the affected job, the shared time, and the dependency path. **Expected now** updates as the clock advances and shows projected status from the schedule.
4. Select the timezone in the navigation to open **Schedule settings** and set a default overrun buffer. Leave a job's buffer blank to inherit it or enter a number to override it. Zero disables buffering for that job. The extra time appears as a striped tail. A conflict that depends on a buffer is reported as possible.
5. Select a past occurrence or browse **Run log → Recent scheduled runs** to record an outcome. Saved entries remain available after editing or deleting a schedule.

For example, schedule UniFi at 23:00 with a conditional outage for UDM Pro. If Internet access depends on UDM Pro and a 23:20 Proxmox job requires Internet access, Wen highlights the overlap while that outage window is active.

## Development and publishing

```sh
npm ci
npm run dev
npm run verify
```

Local development saves the workspace to `data/workspace.json`. Use `WEN_DATA_DIR` to select another location.

Lefthook installs the Git hooks through `npm ci`. Run `npx lefthook install` if your npm settings skip lifecycle scripts. Pre-commit checks staged whitespace and TypeScript. Pre-push runs the test suite and production build via `npm run verify`.

The [GitHub workflow](.github/workflows/publish.yml) runs `npm run verify` on pull requests and pushes to `main`. After CI passes on `main`, a separate job builds and publishes Linux AMD64 and ARM64 images with the `latest` and full commit SHA tags.
