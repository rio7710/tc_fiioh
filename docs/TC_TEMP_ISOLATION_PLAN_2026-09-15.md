# TC temporary isolation plan - 2026-09-15

## Goal

Open `tc.arun.co.kr` temporarily for isolated ThinkCast development on the Mac mini, then remove it after about two weeks with no dependency on existing Arun services.

## Hard boundary

- Shared component allowed: existing Caddy only.
- Everything else is isolated from existing Arun services.
- Do not share existing Arun processes, Docker networks, ports, databases, Redis, object storage, upload folders, environment files, logs, API keys, or worker queues.
- Do not attach TC containers to an existing Arun Docker network.
- Do not reuse existing Arun `.env` files or secrets.

## Target shape

```text
tc.arun.co.kr
  -> existing shared Caddy
  -> 127.0.0.1:43110
  -> tc_temp Docker Compose project
      - tc_temp_web: Node + TypeScript frontend/app
      - tc_temp_api: Node + TypeScript API
      - tc_temp_worker: Python worker
      - tc_temp_data: SQLite and temporary generated files
      - tc_temp_internal: private Docker network
```

## Caddy rule

Keep Caddy as the only shared service. Caddy should proxy only to a localhost-bound port.

```caddyfile
tc.arun.co.kr {
  encode zstd gzip

  header {
    X-Robots-Tag "noindex, nofollow, noarchive"
    Referrer-Policy "no-referrer"
    X-Content-Type-Options "nosniff"
  }

  reverse_proxy 127.0.0.1:43110
}
```

If the site is not meant to be fully public, add Caddy basic auth or the existing access-control layer before launch.

## Compose rules

- Use project name `tc_temp`.
- Bind the public app port to `127.0.0.1` only.
- Prefix every container, volume, and network with `tc_temp`.
- Store SQLite at `/data/tc.sqlite` inside the dedicated volume.
- Store uploads and generated files only in the dedicated TC volume or a clearly named temporary runtime directory.
- Run containers as non-root where practical.
- Add `no-new-privileges:true`.
- Avoid mounting host directories except the app source during development.

Example shape:

```yaml
services:
  web:
    build: ./web
    ports:
      - "127.0.0.1:43110:3000"
    depends_on:
      - api
    networks:
      - tc_internal
    security_opt:
      - no-new-privileges:true

  api:
    build: ./api
    environment:
      SQLITE_PATH: /data/tc.sqlite
      PY_WORKER_URL: http://worker:8000
    volumes:
      - tc_data:/data
    networks:
      - tc_internal
    security_opt:
      - no-new-privileges:true

  worker:
    build: ./worker
    volumes:
      - tc_data:/data
    networks:
      - tc_internal
    security_opt:
      - no-new-privileges:true

volumes:
  tc_data:
    name: tc_temp_data

networks:
  tc_internal:
    name: tc_temp_internal
```

## API and worker isolation

- Browser talks only to the TC API.
- TC API talks only to the TC Python worker over the private Docker network.
- Python worker must not shell out to host paths from existing Arun services.
- API and worker outputs must be JSON-serializable.
- Do not return local paths, provider secrets, API keys, or internal tracebacks to the browser.
- Use explicit job states for long-running work: `queued`, `running`, `succeeded`, `failed`, `cancelled`.

## SQLite policy

- Use SQLite only inside `tc_temp_data`.
- Do not connect to any existing Arun database.
- Do not create automatic backups outside the TC temporary boundary unless explicitly requested.
- Keep schema migration files inside the TC project folder.

## Launch checklist

- `tc.arun.co.kr` Caddy block points to `127.0.0.1:43110`.
- No router port-forwarding is added for Node, Python, or SQLite.
- `docker compose -p tc_temp ps` shows only TC services.
- `docker network inspect tc_temp_internal` contains only TC containers.
- `docker volume inspect tc_temp_data` confirms the dedicated data volume.
- Site response includes `X-Robots-Tag: noindex, nofollow, noarchive`.
- Login, basic auth, or access control is enabled if the site is not intended for open public access.

## Removal plan

Target removal window: about two weeks after 2026-09-15.

Removal steps:

```powershell
docker compose -p tc_temp down -v --remove-orphans
```

Then:

- Remove the `tc.arun.co.kr` Caddy block.
- Reload Caddy.
- Remove or disable DNS for `tc.arun.co.kr` if no longer needed.
- Delete any TC-only runtime directory if one was created outside Docker volumes.
- Revoke any TC-only temporary API tokens.
- Confirm no `tc_temp_*` containers, networks, or volumes remain.

Verification commands:

```powershell
docker ps -a --filter "name=tc_temp"
docker network ls --filter "name=tc_temp"
docker volume ls --filter "name=tc_temp"
```
