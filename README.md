# Cloudflare Container + GameDig template

Template / demo for running [GameDig](https://github.com/gamedig/node-gamedig) on Cloudflare.

GameDig queries game servers over UDP, which Cloudflare Workers can't do directly. Cloudflare **Containers** allow non-HTTP egress, so the GameDig logic runs inside a Container exposed through a Worker router.

```text
Client ──HTTPS──▶ Cloudflare Worker (edge router) ──internal HTTP──▶ Container
                                                                      │ UDP
                                                                      ▼
                                                              <game server>:27015
```

## Architecture

- `src/worker/index.ts` — edge router forwarding `GET /health`, `GET /query`, and `POST /query` to the Container.
- `src/container/index.ts` — Container bootstrap; owns the Bun server and runtime lifecycle.
- `src/container/server.ts` — the Container's HTTP API; validates requests and translates them into Effect programs.
- `src/container/query-params.ts` — parses and validates the allow-listed GET and POST `/query` inputs into one typed GameDig query object.
- `src/container/gamedig/` — GameDig query service with a normalized, schema-validated response, typed errors, and their HTTP projection.

## Endpoints

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/health` | Liveness check. |
| `GET` | `/query?type=<game>&host=<host>` | Backwards-compatible GameDig query for ordinary, non-secret options. |
| `POST` | `/query` | JSON GameDig query. Required when credentials are needed. |

Ordinary GET queries continue to work:

```bash
curl "https://<deployment>/query?type=counterstrike2&host=103.212.227.45&port=27015"
curl "https://<deployment>/query?type=counterstrike2&host=example.com&requestRules=true"
curl "https://<deployment>/query?type=minecraft&host=example.com&socketTimeout=5000&attemptTimeout=15000&maxRetries=2"
```

### GET `/query` parameters

Only the parameters in this table are parsed and forwarded. Unknown URL parameters are ignored rather than being spread into GameDig.

| Option | Input type | Default | Validation / limit | GameDig behavior |
| --- | --- | --- | --- | --- |
| `type` | string | required | Non-empty after trimming. | Logical GameDig game/protocol id. |
| `host` | string | required | Non-empty after trimming. | Required logical host. It remains available to protocols even when `address` is supplied. |
| `address` | string | unset | If supplied, must be non-empty after trimming. | Connection-address override. GameDig skips its own DNS resolution when this is present; it does not replace `host`. |
| `port` | integer | GameDig/game default | `1`–`65535`. | Supplied game/query port. When omitted, GameDig can resolve game defaults, query ports, and offsets. |
| `maxRetries` | integer | `1` | `0`–`3`. | Forwarded unchanged. GameDig 5.3.3 treats `0` as its fallback default because its runtime uses a truthy fallback for this field. |
| `socketTimeout` | integer milliseconds | `2000` | `1`–`15000`. | Timeout for an individual socket/packet operation. |
| `attemptTimeout` | integer milliseconds | `10000` | `1`–`60000`, and must be greater than `socketTimeout`. | Timeout for a complete GameDig attempt. |
| `givenPortOnly` | boolean | `false` | Exactly `true` or `false`. | Restricts GameDig to the supplied port instead of trying resolved/default/offset ports. |
| `ipFamily` | integer enum | `0` | One of `0`, `4`, `6`. | Passed to GameDig DNS lookup: `0` allows either family, `4` requests IPv4, `6` requests IPv6. |
| `debug` | boolean | `false` | Exactly `true` or `false`. | Enables GameDig debug logging for requests without credentials. |
| `stripColors` | boolean | `true` | Exactly `true` or `false`. | Controls color stripping in GameDig protocols that implement it. |
| `noBreadthOrder` | boolean | `false` | Exactly `true` or `false`. | Switches GameDig retry ordering from breadth-first to per-attempt retries. |
| `checkOldIDs` | boolean | `false` | Exactly `true` or `false`. | Allows GameDig to resolve legacy game IDs. |
| `requestRules` | boolean | `false` | Exactly `true` or `false`. | Requests Valve rules when the protocol supports them. |
| `requestPlayers` | boolean | `true` | Exactly `true` or `false`. | Enables/disables the Valve player-list request. |
| `requestRulesRequired` | boolean | `false` | Exactly `true` or `false`. | Makes a requested Valve rules response required instead of tolerating its timeout. |
| `requestPlayersRequired` | boolean | `false` | Exactly `true` or `false`. | Makes a requested Valve player response required instead of tolerating its timeout. |

The non-sensitive protocol-specific options documented below may also be supplied through GET. The sensitive fields `password`, `token`, `apiKey`, and `telnetPassword` are rejected in a GET URL with `400 InvalidQuery` and must use POST JSON.

Boolean parsing is intentionally strict: values such as `1`, `0`, `yes`, `on`, or `TRUE` are rejected with `400 InvalidQuery`.

`attemptTimeout` must always be greater than `socketTimeout`; invalid timeout relationships are rejected before GameDig is called. Retry and timeout caps are API safety limits and are intentionally lower than an unbounded caller-controlled value.

`ipFamily=6` is accepted and forwarded unchanged because `6` is a real GameDig 5.3.3 runtime value. IPv6 egress has not been verified for this Cloudflare Container deployment, so the API does not claim that IPv6 queries will succeed in every deployment. There is no silent IPv4 downgrade. When `address` is supplied, GameDig skips its DNS lookup, so `ipFamily` does not select an address for that request.

### POST `/query` JSON

Use `Content-Type: application/json`. Core query identity stays at the top level and GameDig options go under `options`:

```json
{
  "type": "palworld",
  "host": "example.com",
  "port": 8212,
  "options": {
    "username": "admin",
    "password": "TEST_PASSWORD"
  }
}
```

The `options` object accepts the same generic options as GET plus the protocol-specific options below. JSON values use their natural runtime types: numbers are JSON numbers and booleans are JSON booleans. Unknown properties are not forwarded into GameDig.

Malformed JSON returns `400`. A missing or unsupported content type returns `415`. Invalid option types are rejected before GameDig is called.

Credentials are intentionally not accepted in URLs because URLs are routinely recorded by proxies, access logs, browser history, monitoring systems, and caches. Sensitive values are omitted from returned query metadata and wrapper errors/logging. GameDig 5.3.3 debug mode logs its complete options object, so this service automatically disables GameDig debug for any request carrying a sensitive option.

### Protocol-specific options

These types and consumers are based on GameDig 5.3.3 runtime protocol code rather than only `@types/gamedig`.

| Protocol/game | Option | Type | Sensitive | Runtime use |
| --- | --- | --- | --- | --- |
| Discord | `guildId` | string | No | Discord widget guild identifier; must stay a string because Discord IDs exceed safe JS integer precision. |
| SCP:SL | `accountId` | string | No | Account id sent to the SCP:SL server-info API. |
| SCP:SL | `apiKey` | string | **Yes** | SCP:SL API credential. |
| SCP:SL, alt:V, Broken Protocol, hawakening | `serverId` | string | No | Selects a specific server from the protocol/API result. |
| Farming Simulator | `token` | string | **Yes** | Dedicated-server stats feed code. |
| Terraria / TShock | `token` | string | **Yes** | TShock REST API token. |
| Palworld, hawakening | `username` | string | No | HTTP/backend login username. |
| Palworld, Nadeo, hawakening | `password` | string | **Yes** | Protocol authentication password. |
| Teamspeak 2/3 | `teamspeakQueryPort` | integer | No | TCP ServerQuery port; `1`–`65535`. |
| Nadeo | `login` | string | No | GBXRemote login name. |
| Satisfactory, hawakening | `token` | string | **Yes** | Existing bearer/access token. |
| Satisfactory | `rejectUnauthorized` | boolean | No | TLS certificate verification for the HTTPS API. |
| 7 Days to Die | `telnetPort` | integer | No | Telnet TCP port; `1`–`65535`. |
| 7 Days to Die | `telnetPassword` | string | **Yes** | Telnet authentication password. |
| 7 Days to Die | `moreData` | boolean | No | Enables extra telnet-derived time/version/mod data. |
| Broken Protocol master | `snapshotInterval` | string enum | No | One of `1h`, `6h`, `12h`, `1d`, `3d`, `1w`, `2w`, `4w`. |

Safe credential examples use obvious test-only placeholders:

```bash
curl -X POST "https://<deployment>/query" \
  -H "content-type: application/json" \
  --data '{"type":"palworld","host":"example.com","port":8212,"options":{"username":"admin","password":"TEST_PASSWORD"}}'
```

```bash
curl -X POST "https://<deployment>/query" \
  -H "content-type: application/json" \
  --data '{"type":"scpsl","host":"example.com","options":{"accountId":"TEST_ACCOUNT","apiKey":"TEST_API_KEY","serverId":"42"}}'
```

```bash
curl -X POST "https://<deployment>/query" \
  -H "content-type: application/json" \
  --data '{"type":"7daystodie","host":"example.com","options":{"telnetPort":8081,"telnetPassword":"TEST_TELNET_PASSWORD","moreData":true}}'
```

```bash
curl -X POST "https://<deployment>/query" \
  -H "content-type: application/json" \
  --data '{"type":"satisfactory","host":"example.com","port":7777,"options":{"rejectUnauthorized":false,"token":"TEST_TOKEN"}}'
```

### Internal GameDig options

The public API does **not** expose these GameDig options:

- `portCache` — always forced to `false` internally so one request cannot reuse singleton GameDig port-cache state from another request.
- `listenUdpPort` — constructor-only GameDig configuration and not part of the per-request service API.

Supplying `portCache`, `listenUdpPort`, or another unknown query parameter in the URL or POST options does not forward it to GameDig.

## Windows (WSL) setup

Alchemy local Container development isn't supported on native Windows, so `bun run dev` must run inside WSL2. Unit tests, direct Bun execution, and Docker work fine on Windows; only the local Container dev flow needs WSL.

### Install WSL2 and Ubuntu

In an elevated PowerShell:

```powershell
wsl --install -d Ubuntu
```

Restart when prompted, then finish the distro setup when it first launches (Linux username and password).

### Install the tools

```bash
# bun
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# git
sudo apt update
sudo apt install -y git

# docker (optional, only needed for the local Docker control)
sudo apt install -y docker.io
sudo usermod -aG docker "$USER"
```

Log out and back in (or restart the distro) so the `docker` group takes effect. Verify with `bun --version` and `git --version`.

### Clone and run

Keep the repo on the Linux filesystem (`~/`), not `/mnt/c/`:

```bash
git clone git@github.com:mynameistito/cf-gamedig-container.git
cd cf-gamedig-container
bun install
bun run dev
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
bun run deploy --profile <profile>
```

Check logs after deploying:

```bash
bun alchemy logs --profile <profile> --filter cf-gamedig-worker --since 30m --limit 100
bun alchemy logs --profile <profile> --filter cf-gamedig-container --since 30m --limit 100
```

## Notes

- Alchemy's container stack pins Effect 4 prerelease tooling, and the app uses the same Effect 4 RC; only Effect and GameDig are installed in the runtime image.

## Documentation

- [Alchemy Containers](https://alchemy.run/cloudflare/compute/containers)
- [Cloudflare Containers](https://developers.cloudflare.com/containers/)
- [GameDig](https://github.com/gamedig/node-gamedig)
