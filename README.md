# Wen

Wen is a self-hosted scheduler for home labs. It projects when your scheduled jobs will run, what devices or services they could take offline, and which other jobs could lose a dependency. Record outcomes and notes in the run log.

## Run with Docker Compose

Build and start from this checkout.

```sh
docker compose up -d --build
```

Open <http://localhost:3000>. The app has no authentication and is intended for a trusted LAN. The `wen-data` volume stores jobs, services, schedule settings, and run logs. Keep one app instance per volume and back up the volume to preserve your workspace.

For a registry deployment, copy `compose.yaml` and set `WEN_IMAGE=ghcr.io/<owner>/<repository>:latest` in a `.env` file. Sign in to GHCR first if the package is private, then run:

```sh
docker compose pull
docker compose up -d --no-build
```

Set `WEN_PORT` to change the host port. New workspaces start empty and use `WEN_TIMEZONE`, which defaults to `Europe/London`.

## Track maintenance

1. Add your devices and services under **Services**. On Internet access, select UDM Pro under **Depends on**.
2. Add a job with **New job**. Pick Daily, selected weekdays, or enter five-field cron in the workspace timezone. Set the expected duration, choose required services, and mark each service the job could take offline as Planned or Conditional.
3. Check the **Timeline** for overlapping windows. A conflict identifies the affected job, the shared time, and the dependency path. **Expected now** updates as the clock advances and shows projected status from the schedule.
4. Select the timezone in the navigation to open **Schedule settings** and set a default overrun buffer. Leave a job's buffer blank to inherit it or enter a number to override it. Zero disables buffering for that job. The extra time appears as a striped tail. A conflict that depends on a buffer is reported as possible.
5. Select a past occurrence or browse **Run log → Recent scheduled runs** to record an outcome. Saved entries remain available after editing or deleting a schedule.

For example, schedule UniFi at 23:00 with a conditional outage for UDM Pro. If Internet access depends on UDM Pro and a 23:20 Proxmox job requires Internet access, Wen highlights the overlap while that outage window is active.

## Development and publishing

```sh
npm ci
npm run dev
npm test
npm run build
```

Local development saves the workspace to `data/workspace.json`. Use `WEN_DATA_DIR` to select another location.

A push to GitHub's `main` branch, including a merge, runs the [container workflow](.github/workflows/publish.yml). The build runs the scheduling tests and produces Linux AMD64 and ARM64 images. It publishes the `latest` and full commit SHA tags to GHCR using the repository's Actions token.
