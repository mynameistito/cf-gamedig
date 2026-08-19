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

- `src/worker/index.ts` — edge router forwarding `/health` and `/query` to the Container.
- `src/container/server.ts` — the Container's HTTP API; validates params and translates requests into Effect programs.
- `src/container/query.ts` — parses and validates `?type=&host=&port=` for `/query`.
- `src/container/gamedig/` — GameDig query service with a normalized, schema-validated response.
- `src/shared/` — shared schemas and error-to-HTTP mapping.

## Endpoints

| Route | Description |
| --- | --- |
| `/health` | Liveness check. |
| `/query?type=<game>&host=<host>&port=<port>` | GameDig query against any server. `type` is a GameDig game id (e.g. `counterstrike2`, `minecraft`); `host` and `port` select the server. Returns a normalized server state. |

```bash
curl "https://<deployment>/query?type=counterstrike2&host=103.212.227.45&port=27015"
```

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

- Alchemy's container stack pins Effect 4 prerelease tooling, while the app uses stable Effect aliased as `effect3`; only stable Effect and GameDig are installed in the runtime image.

## Documentation

- [Alchemy Containers](https://alchemy.run/cloudflare/compute/containers)
- [Cloudflare Containers](https://developers.cloudflare.com/containers/)
- [GameDig](https://github.com/gamedig/node-gamedig)
