<p align="center">
  <img src="packages/website/public/logo.svg" width="64" height="64" alt="Rambla logo">
</p>

<h1 align="center">Rambla</h1>

<p align="center">
  <a href="https://github.com/getrambla/rambla/stargazers">
    <img src="https://img.shields.io/github/stars/getrambla/rambla?style=flat&logo=github" alt="GitHub stars">
  </a>
  <a href="https://github.com/getrambla/rambla/releases">
    <img src="https://img.shields.io/github/v/release/getrambla/rambla?style=flat&logo=github" alt="GitHub release">
  </a>
</p>

<p align="center">One interface for Claude Code, Codex, Copilot, OpenCode, Pi, Antigravity, and Muse Code agents.</p>

<p align="center">
  <img src="packages/website/public/hero-mockup.png" alt="Rambla app screenshot" width="100%">
</p>

<p align="center">
  <img src="packages/website/public/mobile-mockup.png" alt="Rambla mobile app" width="100%">
</p>

Rambla is a desktop, mobile, web, and CLI app for coding agents. Open the desktop app and work: agents, editor, terminals, diffs, pull requests, and a browser in one window. Run many agents at once, each in its own worktree, on one machine or several. The mobile app is the full app, native on iOS and Android.

- **Parallel agents:** Run many agents at once, each in its own worktree.
- **Built-in orchestration:** Agents in Rambla can create worktrees, launch other agents, and talk to them, across providers.
- **Full IDE:** Edit files, review diffs, open pull requests, and run terminals, in split panes you arrange how you want.
- **Self-hosted:** Agents run on your machine with your full dev environment. Use your tools, your configs, and your skills.
- **Multi-provider:** Claude Code, Codex, Copilot, OpenCode, Pi, Antigravity, and Muse Code through the same interface. Pick the right model for each job.
- **Voice control:** Dictate tasks or talk through problems in voice mode. Hands-free when you need it.
- **Cross-device:** iOS, Android, desktop, web, and CLI. Start work at your desk, check in from your phone, script it from the terminal.
- **Privacy-first:** Rambla doesn't have any telemetry, tracking, or forced log-ins.

[Run parallel tasks in Rambla](https://rambla.sh/docs/parallel-development): start agents in separate worktrees, review their diffs, run each app, and check it in the built-in browser.

## Plugins

Plugins run on the daemon and show up in every client you connect, with the same UI on desktop, web,
iOS, and Android. Write a plugin once and it is on your phone.

- **UI:** screens, sidebar items, workspace panels, Command Center items, slash commands, composer pills, attachment sources, timeline items, themes.
- **Agent lifecycle:** change configuration, environment, and MCP servers, answer permissions, follow up when a turn ends.
- **Providers:** add a coding agent as a provider.

Install from the registry with `rambla plugin add owner/slug`, or from Git or a local directory.

**[Browse plugins](https://rambla.sh/plugins)** · **[Plugin docs](https://rambla.sh/docs/plugins)**

Plugins run with access to your daemon machine and inside connected clients; install only code you trust.

## Getting Started

Rambla runs a local server called the daemon that manages your coding agents. Clients like the desktop app, mobile app, web app, and CLI connect to it.

### Prerequisites

You need at least one agent CLI installed and configured with your credentials:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)
- [Antigravity](https://rambla.sh/docs/supported-providers#antigravity)
- [Muse Code](https://rambla.sh/docs/muse-code)

### Desktop app (recommended)

Download it from [rambla.sh/download](https://rambla.sh/download) or the [GitHub releases page](https://github.com/getrambla/rambla/releases). Open the app and the daemon starts automatically. Nothing else to install.

To connect from your phone, open **Settings → your host → Pair Device**.

### Server

For a server, a VM, or any machine without the desktop app. Install the CLI and start the daemon:

```bash
npm install -g @getrambla/cli
rambla
```

Rambla starts, then asks whether to enable the end-to-end encrypted relay for device pairing. If you decline, connect directly over TCP, Tailscale, or another VPN. The desktop, mobile, and web apps connect to this daemon like any other host.

For full setup and configuration, see:

- [Docs](https://rambla.sh/docs)
- [Connectivity guide](https://rambla.sh/docs/connectivity)
- [Configuration reference](https://rambla.sh/docs/configuration)

### Docker

Run the Rambla daemon and self-hosted web UI in Docker:

```bash
docker run -d --name rambla \
  -p 6767:6767 \
  -e RAMBLA_PASSWORD=change-me \
  -v "$PWD/rambla-home:/home/rambla" \
  -v "$PWD:/workspace" \
  ghcr.io/getrambla/rambla:latest
```

Open `http://localhost:6767` after it starts. Extend the base image with the agent CLIs you use, then provide credentials through environment variables or the persistent `/home/rambla` volume. See the [Docker documentation](docs/docker.md) for full setup details.

## CLI

Everything you can do in the app, you can do from the terminal.

```bash
rambla run --provider claude/opus-4.6 "implement user authentication"
rambla run --provider codex/gpt-5.5 --worktree feature-x "implement feature X"

rambla ls                           # list running agents
rambla attach abc123                # stream live output
rambla send abc123 "also add tests" # follow-up task

# run on a remote daemon; --cwd is a path on that host
rambla run --host workstation.local:6767 --cwd /workspace "run the full test suite"
```

See the [full CLI reference](https://rambla.sh/docs/cli) for more.

## TypeScript SDK

Build issue integrations, dashboards, and orchestration services with `@getrambla/client`:

```ts
import { createRamblaClient } from "@getrambla/client";

const client = createRamblaClient({ url: "ws://127.0.0.1:6767/ws" });
await client.connect();

const agent = await client.agents.create({
  config: { provider: "codex/gpt-5.5" },
  cwd: "/Users/me/dev/storefront",
  prompt: "Review the current diff and name the riskiest change.",
});

const result = await agent.waitForFinish();
console.log(result.lastMessage);

await client.close();
```

See the [SDK quickstart](https://rambla.sh/docs/sdk/quickstart), [recipes](https://rambla.sh/docs/sdk/recipes), and [API reference](https://rambla.sh/docs/sdk/reference).

## Skills

Skills teach your agent to use Rambla to orchestrate other agents.

```bash
npx skills add getrambla/rambla
```

Then use them in any agent conversation:

- `/rambla-handoff` — hand off work between agents. I use this to plan with Claude and then handoff to Codex to implement.
- `/rambla-advisor` — spin up a single agent as an advisor for a second opinion, without delegating the work itself.
- `/rambla-committee` — form a committee of two contrasting agents to step back, do root cause analysis, and produce a plan.

## Development

Quick monorepo package map:

- `packages/server`: Rambla daemon (agent process orchestration, WebSocket API, MCP server)
- `packages/app`: Expo client (iOS, Android, web)
- `packages/cli`: `rambla` CLI for daemon and agent workflows
- `packages/desktop`: Electron desktop app
- `packages/relay`: Relay transport and encryption used by the daemon and clients
- `packages/website`: Marketing site and documentation (`rambla.sh`)

Common commands:

```bash
# run all local dev services
npm run dev

# run individual surfaces
npm run dev:server
npm run dev:app
npm run dev:desktop
npm run dev:website

# build the server stack
npm run build:server

# repo-wide checks
npm run typecheck
```

## Related projects

- [getrambla/rambla-relay](https://github.com/getrambla/rambla-relay) — official distributed relay, written in Elixir
- [paseo-vscode](https://marketplace.visualstudio.com/items?itemName=hinnes.paseo-vscode) — VS Code extension
- Forked from [getpaseo/paseo](https://github.com/getpaseo/paseo)

## License

Apache-2.0
