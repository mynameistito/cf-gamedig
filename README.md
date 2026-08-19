# Cloudflare Container + GameDig template

Template / demo for running [GameDig](https://github.com/gamedig/node-gamedig) on Cloudflare.

GameDig queries game servers over UDP (e.g. Valve A2S), and Cloudflare Workers do not support
arbitrary outbound UDP sockets. Cloudflare **Containers** allow non-HTTP egress, so the GameDig
(and raw A2S) logic runs inside a Container that is exposed through a Worker router.

```text
Client ──HTTPS──▶ Cloudflare Worker (edge router) ──internal HTTP──▶ Container
                                                                      │
                                                                      ├─ node:dgram raw A2S_INFO
                                                                      └─ GameDig
                                                                           │ UDP
                                                                           ▼
                                                                   <game server>:27015
```

## Architecture

- `src/worker/index.ts` — edge router that forwards `/health`, `/raw-a2s`, and `/gamedig` to the
  Container. Also declares the Container binding, `enableInternet = true`, and
  `sleepAfter = "1m"` (scale-to-zero).
- `src/container/server.ts` — the Container's HTTP API. Translates requests into Effect programs.
- `src/container/a2s/` — raw `node:dgram` A2S_INFO query service (bind/send/receive, challenge
  handling, parsing, timeouts) as a control against which GameDig's result can be compared.
- `src/container/gamedig/` — GameDig query service with a normalized, schema-validated response.
- `src/shared/` — shared schemas and error-to-HTTP mapping.

## Configuration

The target server is fixed at startup via env vars, read once by `AppConfig`:

| Variable      | Default            | Description                    |
| ------------- | ------------------ | ------------------------------ |
| `CS2_HOST`    | `103.212.227.45`   | Game server host               |
| `CS2_PORT`    | `27015`            | Query port                     |
| `A2S_TIMEOUT` | `5000`             | Query timeout in milliseconds  |

## Endpoints

| Route       | Description                                                     |
| ----------- | --------------------------------------------------------------- |
| `/health`   | Liveness check.                                                 |
| `/raw-a2s`  | Raw `node:dgram` A2S_INFO query, returns full packet diagnostics. |
| `/gamedig`  | GameDig query, returns normalized server state.                 |

## Commands

```bash
bun install
bun run typecheck
bun test
bun run check
bun run dev
bun run deploy
bun run destroy
```

Select the Cloudflare account explicitly before deployment:

```bash
bun alchemy login --profile <profile> --configure
ALCHEMY_PROFILE=<profile> bun run deploy
```

PowerShell:

```powershell
$env:ALCHEMY_PROFILE = "<profile>"
bun alchemy login --profile <profile> --configure
bun run deploy
```

After a successful deploy, use the URL printed by Alchemy:

```bash
curl https://<deployment>/health
curl https://<deployment>/raw-a2s
curl https://<deployment>/gamedig
```

Optional local Docker control (Linux image):

```bash
docker build -t cf-gamedig-container .
docker run --rm -p 8080:8080 cf-gamedig-container
curl http://localhost:8080/raw-a2s
curl http://localhost:8080/gamedig
```

## Notes

- Verified in a deployed Cloudflare `lite` Container: outbound UDP and the NAT reply path both
  work, and the container scales to zero after the idle period.
- This demo is built with [Alchemy](https://alchemy.run). Alchemy's container stack pins Effect 4
  prerelease tooling, while the application code uses stable Effect aliased as `effect3`; only
  stable Effect and GameDig are installed in the runtime image.
- Alchemy local Container development is not supported on native Windows. Unit tests, direct Bun
  execution, and Docker work normally; use WSL for `bun run dev` with Containers.

## Documentation

- [Alchemy Containers](https://alchemy.run/cloudflare/compute/containers)
- [Cloudflare Containers](https://developers.cloudflare.com/containers/)
- [Cloudflare outbound traffic](https://developers.cloudflare.com/containers/platform-details/outbound-traffic/)
- [GameDig](https://github.com/gamedig/node-gamedig)
