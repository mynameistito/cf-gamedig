# cf-gamedig-container

Run [GameDig](https://github.com/gamedig/node-gamedig) behind a Cloudflare Worker and Cloudflare Container.

`cf-gamedig-container` exposes a small HTTP API for querying remote game servers with GameDig. The Worker is the public edge entrypoint; it forwards supported requests to a Cloudflare Container, where Bun and GameDig can use the network protocols required by game-server query implementations.

## Overview

GameDig needs capabilities such as UDP, TCP, DNS, and protocol-specific HTTP requests that are not a good fit for running directly inside a Worker. This project keeps the public HTTP edge in a Cloudflare Worker and runs GameDig inside a Cloudflare Container with outbound internet access.

The service currently provides:

- `GET /health` for liveness checks;
- `GET /query` for ordinary non-secret GameDig queries;
- `POST /query` for JSON queries, including credential-bearing protocol options;
- runtime validation against the installed GameDig game and protocol registries;
- GameDig-style port resolution when `port` is omitted;
- a typed, normalized response envelope with protocol-specific data preserved under `raw`;
- bounded retries and timeouts suitable for a public HTTP wrapper.

The application itself can run entirely on Cloudflare. The game server being queried remains an external target and does not need to be hosted on Cloudflare.

## Architecture

```mermaid
flowchart LR
    Client["API client"]
    Worker["Cloudflare Worker<br/>public HTTP router"]
    Binding["Container binding<br/>getContainer(...)"]
    Container["Cloudflare Container<br/>Bun HTTP server"]
    GameDig["GameDig 5.3.3"]
    GameServer["Remote game server"]

    Client -->|HTTPS| Worker
    Worker --> Binding
    Binding -->|internal HTTP| Container
    Container --> GameDig
    GameDig -->|UDP / TCP / HTTP / DNS as required| GameServer
```

The Worker only accepts the public routes documented below and forwards matching requests through the `CONTAINER` binding. The `GameDigContainer` listens on port `8080`, has outbound internet access enabled, and is addressed by the stable container key `cf-gamedig`.

Alchemy provisions the Worker and Container from `alchemy.run.ts`. The current stack uses a `lite` Container, starts with zero instances, allows at most one Cloudflare instance, enables observability, and lets the Container sleep after one minute of inactivity.

## Features

| Area | Current behaviour |
| --- | --- |
| GameDig runtime | Pinned to `gamedig@5.3.3` |
| Game IDs | Validated from GameDig's exported `games` registry |
| Legacy IDs | Supported only when `checkOldIDs=true` |
| Protocol forcing | Supports installed `protocol-*` IDs such as `protocol-valve` |
| Query ports | `port` is optional; GameDig can apply game defaults, `port_query`, and `port_query_offset` |
| Generic options | Typed, allow-listed GET and POST support |
| Protocol options | Typed support for the protocol-specific options listed below |
| Credentials | Sensitive values are rejected in GET URLs and accepted through POST JSON |
| Response | Stable GameDig result fields plus `players[].raw`, `bots[].raw`, and `server.raw` |
| Port cache | Disabled intentionally for every request |
| Runtime model | Cloudflare Worker in front of a Cloudflare Container |

## API

Use the deployed Worker URL as the base URL in the examples below:

```text
https://<deployment>
```

### Routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Return a liveness response from the Container service. |
| `GET` | `/query` | Query a server using URL parameters. Sensitive options are not allowed. |
| `POST` | `/query` | Query a server using a JSON body. Use this form when credentials are required. |

Other public routes or methods are rejected by the Worker.

### `GET /health`

Request:

```bash
curl "https://<deployment>/health"
```

Response:

```json
{
  "service": "cf-gamedig-container",
  "success": true
}
```

### Core query fields

`type` and `host` are always required. `port` is optional.

| Field | GET | POST | Required | Type | Description |
| --- | --- | --- | --- | --- | --- |
| `type` | query parameter | top level | Yes | string | Current GameDig game ID, permitted legacy ID, or installed `protocol-*` ID. Surrounding whitespace is trimmed. |
| `host` | query parameter | top level | Yes | string | Logical hostname or IP passed to GameDig. Must be non-empty. |
| `port` | query parameter | top level | No | integer `1`–`65535` | Supplied game/query port. When omitted, GameDig may resolve a default/query/offset port from game metadata. |

### `GET /query`

GET is intended for ordinary, non-secret queries.

```bash
curl "https://<deployment>/query?type=counterstrike2&host=103.212.227.45&port=27015"
```

URL values are parsed through an allow-list. Unknown query-string parameters are ignored rather than forwarded to GameDig.

GET booleans are strict lowercase strings: only `true` and `false` are accepted. Values such as `1`, `0`, `yes`, `on`, and `TRUE` fail validation.

Sensitive options are rejected even if the rest of the request is valid:

- `apiKey`
- `password`
- `telnetPassword`
- `token`

Use `POST /query` for those fields.

### `POST /query`

POST requests must use `Content-Type: application/json`.

Core identity fields stay at the top level. GameDig options belong under `options`:

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

POST uses natural JSON types: booleans are booleans and numbers are numbers. Unknown object properties are not forwarded into GameDig.

Malformed JSON returns `400`. Missing or unsupported content types return `415`.

### Generic GameDig options

These options are exposed by the wrapper in addition to `type`, `host`, and `port`.

| Option | Type | GET | POST | Default | Validation / behaviour |
| --- | --- | --- | --- | --- | --- |
| `address` | string | Yes | Yes | unset | Non-empty connection-address override. `host` is still required and remains available to protocols. |
| `maxRetries` | integer | Yes | Yes | `1` | `0`–`3`. GameDig 5.3.3 itself treats `0` through its runtime fallback behaviour. |
| `socketTimeout` | integer ms | Yes | Yes | `2000` | `1`–`15000`. Per socket/packet operation. |
| `attemptTimeout` | integer ms | Yes | Yes | `10000` | `1`–`60000` and must be greater than `socketTimeout`. |
| `givenPortOnly` | boolean | Yes | Yes | `false` | Restrict GameDig to the supplied port rather than its normal resolved attempt set. |
| `ipFamily` | `0 \| 4 \| 6` | Yes | Yes | `0` | Passed to GameDig DNS lookup. `0` allows either family. |
| `debug` | boolean | Yes | Yes | `false` | Enables GameDig debug logging unless the request contains a sensitive option. |
| `stripColors` | boolean | Yes | Yes | `true` | Controls GameDig colour stripping in protocols that support it. |
| `noBreadthOrder` | boolean | Yes | Yes | `false` | Uses per-attempt retry ordering instead of breadth-first retry ordering. |
| `checkOldIDs` | boolean | Yes | Yes | `false` | Allows GameDig legacy `old_id` values to resolve. |
| `requestRules` | boolean | Yes | Yes | `false` | Requests Valve rules where supported. Returned rules remain under `server.raw.rules`. |
| `requestPlayers` | boolean | Yes | Yes | `true` | Enables or disables the Valve player-list request. |
| `requestRulesRequired` | boolean | Yes | Yes | `false` | Makes a requested Valve rules response required. |
| `requestPlayersRequired` | boolean | Yes | Yes | `false` | Makes a requested Valve player response required. |

The wrapper caps retries and timeouts before calling GameDig. It also forces `portCache=false` on every request so a successful query port from one request is not reused by another.

When `address` is supplied, GameDig skips its own hostname resolution for the connection address. `host` is still preserved because some protocols use the logical host independently.

### Protocol-specific options

The following protocol-specific options are part of the current public schema. The protocol/game column describes where GameDig 5.3.3 consumes the field; the API itself validates the field's type, not every protocol-specific combination.

| Option | Type | GET | POST | Sensitive | Protocol / purpose |
| --- | --- | --- | --- | --- | --- |
| `guildId` | string | Yes | Yes | No | Discord widget guild ID. Kept as a string to preserve large IDs. |
| `accountId` | string | Yes | Yes | No | SCP: Secret Laboratory server-info account ID. |
| `apiKey` | string | **No** | Yes | **Yes** | SCP: Secret Laboratory API credential. |
| `serverId` | string | Yes | Yes | No | Server selector used by SCP:SL, alt:V, Broken Protocol, and hawakening integrations. |
| `token` | string | **No** | Yes | **Yes** | Credential used by Farming Simulator, Terraria/TShock, Satisfactory, and hawakening integrations. |
| `username` | string | Yes | Yes | No | Login username used by Palworld and hawakening integrations. |
| `password` | string | **No** | Yes | **Yes** | Authentication password used by Palworld, Nadeo, and hawakening integrations. |
| `teamspeakQueryPort` | integer `1`–`65535` | Yes | Yes | No | TeamSpeak 2/3 ServerQuery TCP port. |
| `login` | string | Yes | Yes | No | Nadeo GBXRemote login name. |
| `rejectUnauthorized` | boolean | Yes | Yes | No | Satisfactory HTTPS certificate verification setting. |
| `telnetPort` | integer `1`–`65535` | Yes | Yes | No | 7 Days to Die telnet port. |
| `telnetPassword` | string | **No** | Yes | **Yes** | 7 Days to Die telnet authentication password. |
| `moreData` | boolean | Yes | Yes | No | Enables additional 7 Days to Die telnet-derived data. |
| `snapshotInterval` | string enum | Yes | Yes | No | Broken Protocol snapshot interval: `1h`, `6h`, `12h`, `1d`, `3d`, `1w`, `2w`, or `4w`. |

### GET vs POST

| Behaviour | GET `/query` | POST `/query` |
| --- | --- | --- |
| Core fields | URL query parameters | `type`, `host`, and optional `port` at top level |
| Extra options | URL query parameters | Nested under `options` |
| Numbers | Parsed from strings | JSON numbers |
| Booleans | Exact `true` / `false` strings | JSON booleans |
| Sensitive options | Rejected with `400 InvalidQuery` | Accepted when valid |
| Content type | Not applicable | Must be `application/json` |
| Unknown values | Unknown query parameters are ignored | Unknown schema properties are not forwarded |

Credentials are kept out of URLs because URLs are commonly retained in access logs, proxies, browser history, and monitoring systems. Sensitive values are also omitted from the returned `query` object. Because GameDig debug output can include its full options object, this wrapper forces GameDig `debug` off whenever a request carries `apiKey`, `password`, `telnetPassword`, or `token`.

## Examples

### Basic query

```bash
curl "https://<deployment>/query?type=counterstrike2&host=103.212.227.45&port=27015"
```

### Let GameDig resolve the query port

`port` may be omitted:

```bash
curl "https://<deployment>/query?type=minecraft&host=mc.hypixel.net"
```

The wrapper does not invent a port. GameDig receives an omitted `port` and applies the selected game's runtime metadata.

### Generic options

```bash
curl "https://<deployment>/query?type=counterstrike2&host=103.212.227.45&port=27015&requestRules=true&requestPlayers=false&socketTimeout=5000&attemptTimeout=15000&maxRetries=2"
```

### Force an exact port

```bash
curl "https://<deployment>/query?type=counterstrike2&host=103.212.227.45&port=27015&givenPortOnly=true"
```

### Force a GameDig protocol

```bash
curl "https://<deployment>/query?type=protocol-valve&host=103.212.227.45&port=27015"
```

### Credential-bearing POST request

```bash
curl -X POST "https://<deployment>/query" \
  -H "content-type: application/json" \
  --data '{"type":"palworld","host":"example.com","port":8212,"options":{"username":"admin","password":"TEST_PASSWORD"}}'
```

### Protocol-specific POST options

```bash
curl -X POST "https://<deployment>/query" \
  -H "content-type: application/json" \
  --data '{"type":"sdtd","host":"example.com","options":{"telnetPort":8081,"telnetPassword":"TEST_TELNET_PASSWORD","moreData":true}}'
```

```bash
curl -X POST "https://<deployment>/query" \
  -H "content-type: application/json" \
  --data '{"type":"satisfactory","host":"example.com","port":7777,"options":{"rejectUnauthorized":false,"token":"TEST_TOKEN"}}'
```

### Legacy GameDig ID

Legacy `old_id` values are rejected by default. To enable GameDig's legacy-ID behaviour:

```bash
curl "https://<deployment>/query?type=<legacy-id>&host=example.com&checkOldIDs=true"
```

### Validation failure

```bash
curl "https://<deployment>/query?type=definitely-not-a-gamedig-id&host=example.com"
```

Representative response:

```json
{
  "error": {
    "message": "Invalid type: definitely-not-a-gamedig-id",
    "type": "InvalidQuery"
  },
  "success": false
}
```

## Responses

A successful query returns the normalized query metadata and a schema-validated GameDig server result:

```json
{
  "query": {
    "attemptTimeout": 10000,
    "checkOldIDs": false,
    "debug": false,
    "givenPortOnly": false,
    "host": "103.212.227.45",
    "ipFamily": 0,
    "maxRetries": 1,
    "noBreadthOrder": false,
    "port": 27015,
    "requestPlayers": true,
    "requestPlayersRequired": false,
    "requestRules": false,
    "requestRulesRequired": false,
    "socketTimeout": 2000,
    "stripColors": true,
    "type": "counterstrike2"
  },
  "server": {
    "bots": [],
    "connect": "103.212.227.45:27015",
    "map": "de_dust2",
    "maxplayers": 32,
    "name": "Example Server",
    "numplayers": 1,
    "password": false,
    "ping": 18,
    "players": [
      {
        "name": "Player One",
        "raw": {
          "score": 12
        }
      }
    ],
    "queryPort": 27015,
    "raw": {},
    "version": "1.0"
  },
  "success": true
}
```

The wrapper's stable server fields are:

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | Server name. |
| `map` | string | Current map or protocol-equivalent value. |
| `version` | string | Server/game version. |
| `numplayers` | number | Current player count. GameDig numeric strings are normalized to numbers. |
| `maxplayers` | number | Maximum player count. GameDig numeric strings are normalized to numbers. |
| `players` | array | Each entry contains `name` and protocol-specific `raw`. |
| `bots` | array | Same wrapper shape as players. |
| `ping` | number | GameDig query round-trip measurement. |
| `connect` | string | Connection string reported/constructed by GameDig. |
| `queryPort` | number | Port on which GameDig completed the query. |
| `password` | boolean | Password-protection state normalized from GameDig output. |
| `raw` | object | Protocol-specific server data. Its contents vary by protocol and GameDig patch release. |

Protocol-specific player fields such as score, ping, team, or address remain under `players[].raw`. Protocol-specific server data remains under `server.raw`. The wrapper does not promise a uniform schema inside those `raw` objects.

Sensitive request values are never included in the successful response's `query` object.

## Errors

Public API errors use a JSON envelope with `success: false`.

| HTTP status | Error type | When it is returned |
| --- | --- | --- |
| `400` | `InvalidQuery` | Missing/invalid fields, invalid option values, invalid timeout relationship, unsupported game/protocol ID, or sensitive option supplied through GET. |
| `400` | `InvalidJson` | Malformed POST JSON. |
| `404` | `NotFound` | Unsupported public route or method rejected by the Worker. |
| `415` | `UnsupportedMediaType` | `POST /query` without `Content-Type: application/json`. |
| `502` | `GameDigResponseError` | GameDig returned a result that failed the wrapper's response schema. |
| `504` | `GameDigQueryError` | GameDig failed while trying to query the target server. |

Representative GameDig failure:

```json
{
  "elapsedMs": 10012,
  "error": {
    "message": "GameDig query failed",
    "type": "GameDigQueryError"
  },
  "query": {
    "givenPortOnly": false,
    "host": "example.com",
    "port": 27015,
    "type": "counterstrike2"
  },
  "stage": "gamedig",
  "success": false
}
```

Internal failure causes are not exposed in this response.

## GameDig compatibility

GameDig `5.3.3` is the runtime source of truth for this project. The installed `@types/gamedig@5.0.3` declarations are older and are not treated as authoritative where runtime behaviour differs.

This service intentionally exposes a controlled compatibility surface rather than forwarding arbitrary objects directly into GameDig.

| Compatibility area | Current support |
| --- | --- |
| Current game IDs | Validated directly against the installed GameDig `games` registry. |
| Legacy `old_id` values | Rejected by default; accepted when `checkOldIDs=true`. |
| `protocol-*` forcing | Supported only for protocols exported by the installed GameDig runtime. |
| Game defaults | Delegated to GameDig when `port` is omitted. |
| `port_query` | Delegated to GameDig's runtime resolver. |
| `port_query_offset` | Supplied ports are preserved so GameDig can apply protocol/game offsets. |
| `givenPortOnly` | Exposed with wrapper default `false`. |
| `portCache` | Intentionally forced to `false`; not publicly configurable. |
| `listenUdpPort` | Not exposed by the per-request API. |
| Generic query options | The allow-listed options in this README are forwarded with validated runtime types. |
| Protocol-specific options | The allow-listed protocol fields in this README are forwarded with validated runtime types. |
| Result shape | Stable GameDig result fields are schema validated; protocol-specific data is retained under `raw`. |
| Unknown options | Not forwarded. |
| Wrapper request shape | HTTP-specific: GET query strings or POST `{ type, host, port?, options? }`, not a raw `GameDig.query()` object. |

### Supported games

The repository does not maintain a second hard-coded copy of GameDig's hundreds of game IDs. At runtime, `type` is checked against the registries exported by the installed `gamedig@5.3.3` package.

Useful references:

- [GameDig games list](https://github.com/gamedig/node-gamedig/blob/master/GAMES_LIST.md)
- [GameDig ID migration guide](https://github.com/gamedig/node-gamedig/blob/master/MIGRATE_IDS.md)
- [GameDig 5.3.3 on npm](https://www.npmjs.com/package/gamedig/v/5.3.3)

The installed registry is authoritative for this service even if upstream documentation changes after this repository's pinned version.

### Compatibility limits

This is not a claim of complete one-for-one `GameDig.query()` compatibility.

Current intentional or structural differences include:

- `host` is required by the HTTP schema for every request;
- only documented, allow-listed options are accepted;
- credential-bearing fields must use POST JSON;
- `portCache` is always disabled;
- `listenUdpPort` is not exposed;
- POST uses a wrapper-specific nested `options` object;
- GameDig results are validated and normalized before being returned;
- the service does not expose separate `/games`, `/protocols`, or metadata routes.

## Development

This is an existing Bun/TypeScript/Effect project. Normal editing, dependency installation, type checking, lint/format verification, and unit tests do not require Cloudflare deployment.

### Requirements

| Requirement | Used for |
| --- | --- |
| [Bun](https://bun.sh/) | Package management, scripts, tests, and Container runtime. CI and the Docker image use Bun `1.3.14`. |
| Git | Repository workflow. |
| Docker-compatible CLI and engine | Full local Container development and `docker build .`. |
| Cloudflare account | Deployment only. |
| Alchemy | Installed as a dev dependency; provisions the Worker and Container. |

### Clone and install

```bash
git clone https://github.com/mynameistito/cf-gamedig.git
cd cf-gamedig
bun install
```

### Development commands

| Command | Description |
| --- | --- |
| `bun run dev` | Start Alchemy local development for the Worker + Container stack. |
| `bun run start` | Run the Bun Container HTTP service directly. |
| `bun run typecheck` | Run TypeScript with `--noEmit`. |
| `bun test` | Run the Bun test suite. |
| `bun run check` | Run Ultracite checks. |
| `bun run fix` | Apply Ultracite fixes. |
| `bun run deploy` | Deploy the Alchemy stack. |
| `bun run destroy` | Destroy the Alchemy stack for the selected profile/stage. |

### Local development

With dependencies and a Docker-compatible engine available:

```bash
bun run dev
```

Alchemy builds/runs the Container locally and starts the Worker development runtime. Use the URL printed by Alchemy; the default local Worker URL is typically `http://localhost:1337`.

For work that does not require the Worker-to-Container path, the Container HTTP server can also be started directly:

```bash
bun run start
```

It listens on `PORT`, defaulting to `8080`.

### Windows

Repository tooling can be run natively from PowerShell:

```powershell
bun install
bun run typecheck
bun run check
bun test
docker build .
```

For `bun run dev`, start with native Windows if your Docker-compatible engine is correctly configured. Cloudflare Container local development requires a working Docker CLI/engine; it is not necessary to move the entire development workflow into WSL just to edit, install, typecheck, lint, or test the project.

### WSL 2 fallback

If the full local Worker + Container development path is unreliable in a particular Windows/Docker setup, WSL 2 is a practical fallback for `bun run dev`.

A Windows checkout can be reached from WSL through a path such as:

```text
/mnt/c/Users/<user>/code/cf-gamedig
```

For heavier Linux-side filesystem workloads, keeping the active clone inside the WSL filesystem (for example `~/code/cf-gamedig`) can also avoid `/mnt/c` filesystem overhead.

Inside WSL, with Bun, Git, and a Docker-compatible engine available:

```bash
cd ~/code/cf-gamedig
bun install
bun run dev
```

WSL is a local-development fallback, not a deployment requirement.

## Testing

The test suite covers query parsing, GameDig option forwarding, game/protocol ID validation, protocol-specific options, response schema compatibility, transport behaviour, credential redaction, and error handling.

Before submitting a change, run:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run check
bun test
docker build .
```

The repository's `Verify` GitHub Actions workflow runs the same verification categories on pull requests to `main` using Bun `1.3.14`:

1. frozen dependency install;
2. typecheck;
3. Ultracite check;
4. tests;
5. Docker image build.

## Deployment

Alchemy provisions both Cloudflare resources from `alchemy.run.ts`; there is no separate hand-written Wrangler configuration in this repository.

### Authenticate

Alchemy profiles select the Cloudflare credentials/account used by a command.

To configure a named profile:

```bash
bun alchemy login --profile <profile> --configure
```

The default Alchemy profile is `default` when `--profile` is omitted.

### Deploy to Cloudflare

```bash
bun run deploy --profile <profile>
```

Alchemy shows the deployment plan and returns the Worker URL when the stack is ready.

To remove the deployed stack:

```bash
bun run destroy --profile <profile>
```

### Fully Cloudflare-hosted service

```mermaid
flowchart LR
    Internet["Internet client"]
    Worker["Cloudflare Worker"]
    Container["Cloudflare Container<br/>GameDig + Bun"]
    Target["External game / voice server"]

    Internet -->|HTTPS| Worker
    Worker -->|Container binding| Container
    Container -->|query protocol| Target
```

The service-side compute is Cloudflare-hosted:

| Resource | Current configuration |
| --- | --- |
| Worker | `cf-gamedig-worker`, `nodejs_compat`, observability enabled |
| Container | `cf-gamedig-container`, `lite`, `instances: 0`, `maxInstances: 1` |
| Container runtime | Bun image built from this repository's `Dockerfile` |
| Worker → Container | `CONTAINER` binding, routed with `getContainer(...)` |
| Container egress | Enabled so GameDig can contact remote servers |
| Provisioning | Alchemy |

The target game server is not part of the Cloudflare deployment. The Container queries whatever remote server the API request identifies.

## Configuration

There are no application-wide game-server credentials or hard-coded Cloudflare account IDs in the repository.

| Setting | Required | Default / source | Description |
| --- | --- | --- | --- |
| Alchemy profile | Deployment only | `default` | Selects stored Cloudflare authentication/account context. |
| Cloudflare credentials | Deployment only | Configured by Alchemy login | OAuth or another Cloudflare credential method supported by Alchemy. |
| `PORT` | Container runtime | `8080` | Port used by the Bun Container HTTP server. |
| Query credentials | Per request only | unset | Sent through `POST /query` options when a specific GameDig protocol requires them. |

`alchemy.run.ts` currently uses Alchemy `localState()`. Deployment state therefore lives in the local Alchemy state store used by the machine running the stack rather than a shared repository-backed state store.

## Security

The repository includes several request-boundary protections:

- external inputs are decoded through Effect Schema rather than spread directly into GameDig;
- game/protocol IDs are validated before the GameDig network call;
- retries and timeouts are capped;
- credential fields are rejected in GET URLs;
- successful responses omit `apiKey`, `password`, `telnetPassword`, and `token`;
- GameDig debug mode is forced off for credential-bearing requests;
- Container JSON responses use `Cache-Control: no-store`;
- `portCache` is disabled to avoid sharing GameDig's singleton port-cache state across requests.

There are also important deployment considerations:

- there is no authentication or authorization layer in this repository;
- there is no built-in rate limiter;
- `host` and optional `address` are not restricted to an allow-list;
- there is no private/reserved-address block in the request parser;
- the Container has outbound internet access;
- a public deployment can therefore be asked to initiate GameDig-supported network traffic toward arbitrary destinations reachable from the Container.

If the Worker is exposed to untrusted callers, add any required authentication, rate limiting, and destination policy at the deployment/application boundary before treating it as a general public query proxy.

POST keeps credentials out of the URL, but credentials still necessarily exist in the request body and in process memory while the selected GameDig protocol uses them.

## Limitations

- Cloudflare Container IPv6 egress has not been verified by this repository. `ipFamily=6` is accepted and forwarded without silently downgrading to IPv4.
- Some GameDig protocols require protocol-specific server configuration or options beyond a basic host/port.
- GameDig `raw` data is intentionally protocol-specific and may change between GameDig patch releases.
- `maxInstances` is currently `1`, so this stack is configured as a small service rather than a horizontally scaled public query fleet.
- Local Container development requires a working Docker-compatible engine.
- Alchemy state is currently local to the deployment environment.
- The HTTP wrapper exposes a deliberate subset of GameDig options rather than arbitrary passthrough.

## Project structure

```text
.
├── .github/workflows/verify.yml   # Pull-request verification
├── src/
│   ├── worker/
│   │   └── index.ts               # Public Worker router and Container binding
│   └── container/
│       ├── index.ts               # Bun server bootstrap
│       ├── server.ts              # HTTP routes and response mapping
│       ├── query-params.ts        # GET/POST schemas, defaults, limits, redaction
│       ├── game-type.ts           # GameDig game/protocol ID validation
│       └── gamedig/
│           ├── service.ts         # Effect service around GameDig.query()
│           ├── schema.ts          # Runtime response validation
│           └── errors.ts          # Typed GameDig failure model
├── test/                          # Bun test suite
├── alchemy.run.ts                 # Cloudflare Worker + Container resources
├── Dockerfile                     # Production Container image
└── package.json                   # Scripts and pinned dependencies
```

## Contributing

Keep changes focused and run the repository verification commands before opening a pull request:

```bash
bun run typecheck
bun run check
bun test
docker build .
```

When changing API behaviour, update the relevant schemas/tests and keep this README synchronized with the actual public surface.

## License

[MIT](LICENSE).

## References

- [GameDig](https://github.com/gamedig/node-gamedig)
- [GameDig 5.3.3 package](https://www.npmjs.com/package/gamedig/v/5.3.3)
- [Cloudflare Containers](https://developers.cloudflare.com/containers/)
- [Cloudflare Containers local development](https://developers.cloudflare.com/containers/local-dev/)
- [Alchemy Containers](https://alchemy.run/cloudflare/compute/containers)
- [Alchemy profiles](https://alchemy.run/environments/profiles/)
