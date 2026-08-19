# Cloudflare Container + GameDig template

Template / demo for running [GameDig](https://github.com/gamedig/node-gamedig) on Cloudflare.

GameDig queries game servers over UDP (e.g. Valve A2S), and Cloudflare Workers do not support arbitrary outbound UDP sockets. Cloudflare **Containers** allow non-HTTP egress, so the GameDig logic runs inside a Container that is exposed through a Worker router.

```text
Client ──HTTPS──▶ Cloudflare Worker (edge router) ──internal HTTP──▶ Container
                                                                      │ UDP
                                                                      ▼
                                                              <game server>:27015
```

## Architecture

- `src/worker/index.ts` — edge router that forwards `/health` and `/query` to the Container. Also declares the Container binding, `enableInternet = true`, and `sleepAfter = "1m"` (scale-to-zero).
- `src/container/server.ts` — the Container's HTTP API. Validates request params and translates requests into Effect programs.
- `src/container/query.ts` — parses and validates `?type=&host=&port=` for the `/query` route.
- `src/container/gamedig/` — GameDig query service with a normalized, schema-validated response.
- `src/shared/` — shared schemas and error-to-HTTP mapping.

## Configuration

`/query` is fully parameterized by the caller, so no environment configuration is required.

## Endpoints

| Route | Description |
| --- | --- |
| `/health` | Liveness check. |
| `/query?type=<game>&host=<host>&port=<port>` | GameDig query against an arbitrary server. `type` is a GameDig game id (e.g. `counterstrike2`, `minecraft`); `host` and `port` select the server. Returns a normalized server state. |

Example:

```bash
curl "https://<deployment>/query?type=counterstrike2&host=103.212.227.45&port=27015"
```

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
curl "https://<deployment>/query?type=counterstrike2&host=103.212.227.45&port=27015"
ALCHEMY_PROFILE=<profile> bun alchemy logs --filter KzgGameDigPoc --since 30m --limit 100
ALCHEMY_PROFILE=<profile> bun alchemy logs --filter KzgContainer --since 30m --limit 100
```

Optional local Docker control (Linux image):

```bash
docker build -t cf-gamedig-container .
docker run --rm -p 8080:8080 cf-gamedig-container
curl "http://localhost:8080/query?type=counterstrike2&host=103.212.227.45&port=27015"
```

## Notes

- Verified in a deployed Cloudflare `lite` Container: outbound UDP and the NAT reply path both work, and the container scales to zero after the idle period.
- This demo is built with [Alchemy](https://alchemy.run). Alchemy's container stack pins Effect 4 prerelease tooling, while the application code uses stable Effect aliased as `effect3`; only stable Effect and GameDig are installed in the runtime image.
- Alchemy local Container development is not supported on native Windows. Unit tests, direct Bun execution, and Docker work normally; use WSL for `bun run dev` with Containers.

## Documentation

- [Alchemy Containers](https://alchemy.run/cloudflare/compute/containers)
- [Cloudflare Containers](https://developers.cloudflare.com/containers/)
- [Cloudflare outbound traffic](https://developers.cloudflare.com/containers/platform-details/outbound-traffic/)
- [GameDig](https://github.com/gamedig/node-gamedig)
