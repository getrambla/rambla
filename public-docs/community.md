---
title: Related projects
description: Projects related to Rambla and built by the community.
nav: Related projects
order: 7
category: Getting started
---

# Related projects

These projects are related to Rambla and built by the community.

## Plugins

Browse the [plugin registry](/plugins) for reviewed community plugins. To share your own, follow
[Publish a plugin](/docs/plugins/publishing) for package preparation and submission.
Plugins run unsandboxed; read their listing and source before installing.

## Tools and integrations

| Project                                                                                        | What it does                                                                                                                         |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [Rambla for VS Code](https://marketplace.visualstudio.com/items?itemName=hinnes.rambla-vscode) | Opens the matching Rambla project or worktree in VS Code and adds agent chat, file mentions, and editor links.                       |
| [VS Code Web plugin](https://github.com/itsjustanks/rambla-plugin-vscode-web)                  | Opens a live Rambla worktree in `vscode.dev` through a VS Code tunnel, including workspaces on headless hosts.                       |
| [Rambla Icon](https://github.com/gpambrozio/rambla-menubar)                                    | Shows workspace status across Rambla hosts in the macOS menu bar and opens a workspace with one click.                               |
| [Rambla Cross-Daemon Comms](https://github.com/xpufx/rambla-cross-daemon-comms)                | Lets agents communicate with agents on another Rambla daemon through an MCP server.                                                  |
| [Rambla Antigravity ACP](https://github.com/tiezbro/rambla-agy-acp)                            | Connects Google Antigravity CLI to Rambla through ACP, with Rambla-specific context, permissions, and concurrency handling.          |
| [Desvio](https://github.com/cleiter/desvio)                                                    | Rebuilds a personal fork from a set of branches, using an agent to resolve new conflicts and Git rerere to replay known resolutions. |

## Hosting and infrastructure

| Project                                                                       | What it does                                                                                                                                                               |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Rambla Self-hosted](https://github.com/blockfeed/rambla-selfhosted)          | Packages the Rambla web UI and a local daemon as a Docker deployment.                                                                                                      |
| [Devbox Fleet](https://github.com/omrihaviv/devbox-fleet)                     | Provisions and maintains per-developer GCP devboxes with Rambla, coding agents, and Tailscale access.                                                                      |
| [Rambla Vercel Sandbox](https://github.com/vercel-labs/rambla-vercel-sandbox) | Creates persistent Vercel Sandboxes running a Rambla daemon with Codex, Claude Code, OpenCode, or Pi through Vercel AI Gateway. Pair each sandbox as a remote Rambla host. |
