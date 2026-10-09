# Changelog

Rambla is a fork of Paseo. Each release lists Rambla's own changes first, followed by the Paseo changes included in that release.

## Unreleased

### Rambla — Added

- 2026-10-02 - [dda783d](https://github.com/getrambla/rambla/commit/dda783d) - [2026-10-02-feat-rambla-server-image.md](plans/2026-10-02-feat-rambla-server-image.md) - Added daemon-only rambla-server Docker image with mise, published to GHCR on release tags or with just publish-server.
- 2026-09-27 - [4ea2f8514](https://github.com/getrambla/rambla/commit/4ea2f8514) - [2026-09-26-feat-active-projects-only.md](plans/2026-09-26-feat-active-projects-only.md) - Added an Active projects default filter to the sidebar Project page.
- 2026-09-24 - [**\_\_\_**](https://github.com/getrambla/rambla/commit/**___**) - [2026-09-24-feat-user-adjustable-composer-height.md](plans/2026-09-24-feat-user-adjustable-composer-height.md) - Gave the composer a fixed, user-defined height: drag the top handle to resize (2-line floor, window-top ceiling), release to pin, double-tap to restore the 3-line default; content auto-grow removed.
- 2026-09-24 - [2f02b83](https://github.com/getrambla/rambla/commit/2f02b8312) - [2026-09-22-feat-os-notification-toggle.md](plans/2026-09-22-feat-os-notification-toggle.md) - Added a settings switch that turns OS notifications off, hides the notifications card, and removes the refresh button.

### Rambla — Fixed

- 2026-10-02 - [df21a6a](https://github.com/getrambla/rambla/commit/df21a6af5) - [2026-10-02-fix-question-card-text-selection.md](plans/2026-10-02-fix-question-card-text-selection.md) - Fixed agent question card text being unselectable on web: question, options, and descriptions can now be drag-selected and read by screen readers.
- 2026-10-01 - [6b82063](https://github.com/getrambla/rambla/commit/6b8206396) - [2026-10-01-fix-user-bubble-top-right-radius.md](plans/2026-10-01-fix-user-bubble-top-right-radius.md) - Fixed the user message bubble's square top-right corner; all four corners now share the same radius.
- 2026-09-30 - [b048cc0](https://github.com/getrambla/rambla/commit/b048cc02c) - [2026-09-30-fix-link-tooltip-stuck-on-click.md](plans/2026-09-30-fix-link-tooltip-stuck-on-click.md) - Fixed clicking a chat file link leaving its path tooltip stuck on screen.
- 2026-09-30 - [862f159](https://github.com/getrambla/rambla/commit/862f159) - [2026-09-30-fix-sidebar-shortcut-hover-wrap.md](plans/2026-09-30-fix-sidebar-shortcut-hover-wrap.md) - Fixed top sidebar rows wrapping: labels truncate, fade into the shortcut on hover, and screen readers hear the shortcut.
- 2026-09-30 - [71e5a20](https://github.com/getrambla/rambla/commit/71e5a20) - [2026-09-30-fix-thinking-picker-stale-list.md](plans/2026-09-30-fix-thinking-picker-stale-list.md) - Fixed thinking picker offering levels the custom ACP model doesn't support.
- 2026-09-30 - [c1a6be8](https://github.com/getrambla/rambla/commit/c1a6be8) - [2026-09-30-fix-eradicate-generated-blobs.md](plans/2026-09-30-fix-eradicate-generated-blobs.md) - Moved generated mermaid and terminal webview blobs out of app sources into a build-time package.
- 2026-09-26 - [de47f4f](https://github.com/getrambla/rambla/commit/de47f4fb8) - [2026-09-26-fix-composer-ios-bottom-spacing.md](plans/2026-09-26-fix-composer-ios-bottom-spacing.md) - Slimmed the composer's bottom spacing on iOS: smaller gap under the panel and above the controls, keyboard alignment kept.
- 2026-09-24 - [73aa827](https://github.com/getrambla/rambla/commit/73aa827) - [2026-09-24-fix-subagent-default-provider-model.md](plans/2026-09-24-fix-subagent-default-provider-model.md) - Fixed create_agent requiring a provider name: a subagent now inherits the caller's provider and model when none is named.
- 2026-09-24 - [5376d23](https://github.com/getrambla/rambla/commit/5376d23) - [2026-09-24-fix-ios-link-scroll-gate.md](plans/2026-09-24-fix-ios-link-scroll-gate.md) - Fixed lifting a finger off an assistant file link after scrolling the chat on iOS opening the link.
- 2026-09-24 - b7138f6 - (no plan) - Bump react-native-uitextview to 2.7.1 to improve a11y on iOS.

**Before upgrading:** `paseo plugin add owner/repo` now installs from the registry, so use `github:owner/repo` to install straight from GitHub and `./path` for a local directory.

### From Paseo — Added

- Added Claude Haiku 5.5 for Claude Code 2.1.293 and newer ([#6332](https://github.com/getpaseo/paseo/pull/6332))

- Added Muse Code as a provider, with model, approval mode, and reasoning effort controls ([#5719](https://github.com/getpaseo/paseo/pull/5719), [#5775](https://github.com/getpaseo/paseo/pull/5775) by [@millerben95](https://github.com/millerben95))
- Added Antigravity as a provider that drives the installed `agy` CLI, always in Full access ([#5714](https://github.com/getpaseo/paseo/pull/5714), [#5795](https://github.com/getpaseo/paseo/pull/5795))
- Added Usage, opened from the sidebar footer as a dialog on desktop and a sheet on mobile, showing each subscription account's quota windows with Refresh ([#5465](https://github.com/getpaseo/paseo/pull/5465), [#5685](https://github.com/getpaseo/paseo/pull/5685), [#5786](https://github.com/getpaseo/paseo/pull/5786), [#5805](https://github.com/getpaseo/paseo/pull/5805), [#5921](https://github.com/getpaseo/paseo/pull/5921), [#6216](https://github.com/getpaseo/paseo/pull/6216))
- Added an opt-in Usage summary to the sidebar footer that shows the windows you pin ([#5903](https://github.com/getpaseo/paseo/pull/5903), [#5975](https://github.com/getpaseo/paseo/pull/5975), [#6089](https://github.com/getpaseo/paseo/pull/6089))
- Added Usage discovery of ChatGPT logins from Codex CLI, OpenCode, Pi, and OMP ([#5844](https://github.com/getpaseo/paseo/pull/5844))
- Added Usage discovery of Claude logins from the Claude Code credential file, the macOS keychain, Pi, and OMP ([#5844](https://github.com/getpaseo/paseo/pull/5844))
- Added OpenCode Go to Usage ([#5465](https://github.com/getpaseo/paseo/pull/5465))
- Added the reason a Usage card is unavailable, such as an expired login with the command that refreshes it, listing each login's error when none works ([#5876](https://github.com/getpaseo/paseo/pull/5876), [#6156](https://github.com/getpaseo/paseo/pull/6156))
- Added mid-turn steering to OMP agents ([#5550](https://github.com/getpaseo/paseo/pull/5550) by [@n24q02m](https://github.com/n24q02m))
- Added Fast mode and an Auto thinking level to OMP ([#5550](https://github.com/getpaseo/paseo/pull/5550) by [@n24q02m](https://github.com/n24q02m), [@abhi-wan-kenobi](https://github.com/abhi-wan-kenobi))
- Added MCP servers to OMP schedules and Hub runs ([#5550](https://github.com/getpaseo/paseo/pull/5550) by [@omercnet](https://github.com/omercnet))
- Added a Content width setting for the maximum width of chat and Markdown files on wide screens ([#5680](https://github.com/getpaseo/paseo/pull/5680))
- Added syntax highlighting for Vue files ([#6205](https://github.com/getpaseo/paseo/pull/6205) by [@Davnn1](https://github.com/Davnn1))
- Added `agents.providers.<id>.options` in `config.json` as default options for every provider, with per-agent overrides ([#5780](https://github.com/getpaseo/paseo/pull/5780))
- Added the terminal key bar and Paste to terminal panes on iPad and Android tablets ([#5712](https://github.com/getpaseo/paseo/pull/5712) by [@lardissone](https://github.com/lardissone))

- Added a confirmation before a pairing link connects to a new host or to a saved host whose key or relay changed ([#5753](https://github.com/getpaseo/paseo/pull/5753))

- Added Claude Sonnet 5.5 for Claude Code 2.1.284 and newer ([#5583](https://github.com/getpaseo/paseo/pull/5583) by [@yangqi](https://github.com/yangqi))

- Added OpenCode v2 support, selected automatically from the installed `opencode` version ([#5198](https://github.com/getpaseo/paseo/pull/5198), [#5526](https://github.com/getpaseo/paseo/pull/5526) by [@karrots](https://github.com/karrots), [@dsingal0](https://github.com/dsingal0), [@gszep](https://github.com/gszep))
- Added task lists from rpiv-todo, pi-goal-x, and Pi's example todo extension to Pi chats ([#5309](https://github.com/getpaseo/paseo/pull/5309))
- Added subagent runs from pi-subagents, Tintinweb pi-subagents, and Gotgenes pi-subagents to the Subagents track ([#5309](https://github.com/getpaseo/paseo/pull/5309))
- Added rpiv-ask-user-question dialogs to Pi chats as one question form ([#5309](https://github.com/getpaseo/paseo/pull/5309))
- Added password checks to relay connections, rejecting an incorrect daemon password; a follow-up release will require the password ([#5393](https://github.com/getpaseo/paseo/pull/5393))
- Added a password field to Add host, pairing links, and QR pairing for password-protected daemons ([#5393](https://github.com/getpaseo/paseo/pull/5393))
- Added `relay://` connection strings to `paseo daemon pair` ([#5393](https://github.com/getpaseo/paseo/pull/5393))
- Added OMP Ask option descriptions to question cards on OMP 17.4.2 and newer ([#3628](https://github.com/getpaseo/paseo/pull/3628) by [@joeshull](https://github.com/joeshull))

- Added structured Claude Code launch arguments for session configuration and plugins ([#5206](https://github.com/getpaseo/paseo/pull/5206))

- Added Opus 5.5 to the Claude catalog as its default model, with a 1M context window and Fast Mode, on Claude Code 2.1.280 and newer ([#5200](https://github.com/getpaseo/paseo/pull/5200) by [@leonardourci](https://github.com/leonardourci), [@sebgalind0](https://github.com/sebgalind0), [@rp4ri](https://github.com/rp4ri))

- Added Cmd/Ctrl+F Find to file panes, with replacement in editable files ([#4589](https://github.com/getpaseo/paseo/pull/4589))
- Added Cmd/Ctrl+F Find to terminal scrollback ([#4650](https://github.com/getpaseo/paseo/pull/4650))
- Added Cmd/Ctrl+F Find to chat, including messages outside the loaded history window ([#4765](https://github.com/getpaseo/paseo/pull/4765))
- Added Jump to file to mobile Changes, opening the changed-files tree in a sheet ([#4861](https://github.com/getpaseo/paseo/pull/4861))
- Added automatic Pull request tab opening once per workspace when a PR is detected ([#4956](https://github.com/getpaseo/paseo/pull/4956))
- Added expandable plan cards, with rejected plans collapsed by default ([#4756](https://github.com/getpaseo/paseo/pull/4756))
- Added an attachment placeholder with a spinner while a selected file uploads ([#4958](https://github.com/getpaseo/paseo/pull/4958))
- Added match highlighting to the workspace, agent, project, and branch fields in History search ([#4945](https://github.com/getpaseo/paseo/pull/4945))

### From Paseo — Fixed

- Fixed Claude tool calls that run longer than 30 seconds, such as WebFetch or MCP tools, showing up as subagents ([#6308](https://github.com/getpaseo/paseo/pull/6308))
- Fixed subagents that finish while the app is disconnected staying "working" until one is opened ([#6316](https://github.com/getpaseo/paseo/pull/6316))
- Fixed a Claude agent's history showing "No activity to display" after a daemon restart when its transcript is in another project folder, such as after moving the daemon or running Windows Claude Code from WSL ([#6301](https://github.com/getpaseo/paseo/pull/6301))

- Fixed Claude agents never showing Thought rows on Claude Opus 4.7 and later ([#4355](https://github.com/getpaseo/paseo/pull/4355) by [@ThePharmer](https://github.com/ThePharmer))
- Fixed a Claude agent showing as running while only its background helpers worked, and a send or Stop killing those helpers ([#6295](https://github.com/getpaseo/paseo/pull/6295) by [@IsakPersson](https://github.com/IsakPersson))
- Fixed a Claude agent in Auto mode failing to switch modes when Claude Code uses Bedrock or Vertex ([#6272](https://github.com/getpaseo/paseo/pull/6272))
- Fixed a Claude subagent's auto-mode report showing as a raw SubagentHandback tool card instead of markdown ([#6248](https://github.com/getpaseo/paseo/pull/6248))
- Fixed background Claude subagent cards showing as a bare "Task" that stayed running, as "Agent" after a daemon restart, or unlabeled when two launch together ([#6067](https://github.com/getpaseo/paseo/pull/6067), [#6100](https://github.com/getpaseo/paseo/pull/6100), [#6268](https://github.com/getpaseo/paseo/pull/6268))
- Fixed Claude Code terminals not showing as needing input when Claude is idle ([#6022](https://github.com/getpaseo/paseo/pull/6022))
- Fixed Claude usage calling a rate-limited login again before its retry time ([#6089](https://github.com/getpaseo/paseo/pull/6089))
- Fixed a Claude agent that entered plan mode on its own still showing and storing its previous mode ([#6074](https://github.com/getpaseo/paseo/pull/6074))
- Fixed a resumed agent returning to its creation-time mode after its mode was changed in the session ([#5140](https://github.com/getpaseo/paseo/pull/5140) by [@ThePlenkov](https://github.com/ThePlenkov))
- Fixed ACP plugin providers failing to launch a `.cmd` or `.bat` CLI on Windows ([#6151](https://github.com/getpaseo/paseo/pull/6151))
- Fixed ACP agents running on their default model when the configured model is one the agent does not advertise ([#6273](https://github.com/getpaseo/paseo/pull/6273))
- Fixed archiving an ACP agent leaving its provider running when the provider never answers close ([#6213](https://github.com/getpaseo/paseo/pull/6213) by [@apple-ouyang](https://github.com/apple-ouyang))
- Fixed an archived ACP agent showing an empty chat after its worktree was removed ([#6228](https://github.com/getpaseo/paseo/pull/6228))
- Fixed ACP agents rejecting every following message after a turn failed with a permission request open ([#6045](https://github.com/getpaseo/paseo/pull/6045))
- Fixed the context window meter never appearing for ACP agents that report context usage ([#4848](https://github.com/getpaseo/paseo/pull/4848) by [@apple-ouyang](https://github.com/apple-ouyang))
- Fixed schedule runs and workspace metadata recording `[object Object]` when an ACP agent rejects a session setting ([#5765](https://github.com/getpaseo/paseo/pull/5765))
- Fixed OMP agents staying bound to a dead `omp` process after it crashed ([#5550](https://github.com/getpaseo/paseo/pull/5550) by [@viet-initx](https://github.com/viet-initx))
- Fixed OMP multi-select questions showing radio buttons and asking once per choice ([#5550](https://github.com/getpaseo/paseo/pull/5550))
- Fixed `/compact` on OMP reporting a failure after 60s while OMP kept compacting ([#5550](https://github.com/getpaseo/paseo/pull/5550) by [@Kh05ifr4nD](https://github.com/Kh05ifr4nD))
- Fixed `paseo import --provider omp` starting the agent on the default model instead of the session's ([#5550](https://github.com/getpaseo/paseo/pull/5550) by [@alloevil](https://github.com/alloevil))
- Fixed OMP-injected rows showing a `[custom_message]` prefix after a reload ([#5550](https://github.com/getpaseo/paseo/pull/5550) by [@jegork](https://github.com/jegork))
- Fixed OMP tool rows showing raw objects or generic labels for failed tools, Task, Wait, web search, and fetch ([#5550](https://github.com/getpaseo/paseo/pull/5550))
- Fixed results of OMP `xd://` writes disappearing from the timeline ([#5550](https://github.com/getpaseo/paseo/pull/5550) by [@kasrakhosravi](https://github.com/kasrakhosravi))
- Fixed the composer showing the stale model after an OMP model fallback ([#5550](https://github.com/getpaseo/paseo/pull/5550) by [@gray-graff](https://github.com/gray-graff))
- Fixed opening an archived OMP agent starting an `omp` process that stayed running ([#5550](https://github.com/getpaseo/paseo/pull/5550) by [@thomasvan](https://github.com/thomasvan))
- Fixed an OMP turn staying running forever when the run contains a message Paseo does not show, such as an OMP rule reminder ([#6112](https://github.com/getpaseo/paseo/pull/6112))
- Fixed a prompt OMP rejects, such as for a missing API key, ending as a completed turn with no error ([#6110](https://github.com/getpaseo/paseo/pull/6110), [#6115](https://github.com/getpaseo/paseo/pull/6115))
- Fixed reopened OMP chats showing "Custom message" rows for compactions and other entries OMP writes on its own ([#6198](https://github.com/getpaseo/paseo/pull/6198), [#6215](https://github.com/getpaseo/paseo/pull/6215))
- Fixed Pi and OMP sessions whose model was removed failing to import or reopen ([#6061](https://github.com/getpaseo/paseo/pull/6061))
- Fixed Pi agents on Pi 0.99 starting without Paseo's MCP servers when `pi-mcp-adapter` is not installed ([#5762](https://github.com/getpaseo/paseo/pull/5762) by [@ArietidsZ](https://github.com/ArietidsZ))
- Fixed a running Pi subagent showing an empty transcript until it finished ([#5755](https://github.com/getpaseo/paseo/pull/5755))
- Fixed a grouped Tintinweb pi-subagents completion marking only its first agent completed and leaving the rest on working ([#5826](https://github.com/getpaseo/paseo/pull/5826))
- Fixed OpenCode `ask` rules for `paseo_*` tools running the tool without a prompt ([#5801](https://github.com/getpaseo/paseo/pull/5801) by [@ymarcus93](https://github.com/ymarcus93))
- Fixed the first OpenCode prompt waiting for the event stream timeout when the OpenCode server was slow to become ready ([#5873](https://github.com/getpaseo/paseo/pull/5873) by [@axsuul](https://github.com/axsuul))
- Fixed OpenCode v2 agents staying running after a question is dismissed or a tool permission is denied ([#6177](https://github.com/getpaseo/paseo/pull/6177), [#6188](https://github.com/getpaseo/paseo/pull/6188))
- Fixed the Nix packages failing to start the daemon and to open terminals ([#5523](https://github.com/getpaseo/paseo/pull/5523) by [@wongcallum](https://github.com/wongcallum))
- Fixed OpenCode v2 agents failing to start on the Nix packages ([#5988](https://github.com/getpaseo/paseo/pull/5988))
- Fixed each Paseo skill appearing twice in Codex's skill list ([#5827](https://github.com/getpaseo/paseo/pull/5827) by [@3ae3ae](https://github.com/3ae3ae))
- Fixed a failed Codex image generation leaving no row in the chat ([#5810](https://github.com/getpaseo/paseo/pull/5810) by [@3ae3ae](https://github.com/3ae3ae))
- Fixed a denied Codex command or file edit keeping a running spinner after the turn ended ([#5717](https://github.com/getpaseo/paseo/pull/5717) by [@3ae3ae](https://github.com/3ae3ae))
- Fixed rewinding a legacy Codex chat failing with `unknown variant thread/rollback` on Codex 0.156 and newer ([#5711](https://github.com/getpaseo/paseo/pull/5711) by [@3ae3ae](https://github.com/3ae3ae))
- Fixed Codex custom prompt arguments containing `$` sequences reaching Codex altered ([#5669](https://github.com/getpaseo/paseo/pull/5669) by [@3ae3ae](https://github.com/3ae3ae))
- Fixed Codex structured output failing when the schema has a field named `properties` ([#5684](https://github.com/getpaseo/paseo/pull/5684))
- Fixed a Codex agent created without a thinking option losing its default effort after a daemon restart ([#5686](https://github.com/getpaseo/paseo/pull/5686))
- Fixed only one permission showing when Codex asks to approve two commands from one item ([#5758](https://github.com/getpaseo/paseo/pull/5758))
- Fixed Codex terminal rows reading only "Terminal" without the command on current Codex ([#5774](https://github.com/getpaseo/paseo/pull/5774))
- Fixed the composer showing the catalog default thinking level instead of the one the agent runs on ([#5804](https://github.com/getpaseo/paseo/pull/5804))
- Fixed the composer showing another model's label when the agent's model is missing from the loaded catalog ([#5796](https://github.com/getpaseo/paseo/pull/5796))
- Fixed the chat jumping back by several screens when scrolling up through older history on web and desktop ([#5945](https://github.com/getpaseo/paseo/pull/5945), [#5970](https://github.com/getpaseo/paseo/pull/5970), [#6172](https://github.com/getpaseo/paseo/pull/6172))
- Fixed images in chat shifting the text below them when they finish loading ([#5970](https://github.com/getpaseo/paseo/pull/5970))
- Fixed copying all the code in a chat code block sometimes including its ``` fence lines ([#6138](https://github.com/getpaseo/paseo/pull/6138))
- Fixed copying across a code block nested in a numbered list item renumbering the next item ([#6158](https://github.com/getpaseo/paseo/pull/6158))
- Fixed copying a chat selection across an image losing its alt text and source, or including the image when the selection started below it ([#6181](https://github.com/getpaseo/paseo/pull/6181), [#6195](https://github.com/getpaseo/paseo/pull/6195))
- Fixed relative `path:line` file links in chat opening at the first line referenced for that file ([#5653](https://github.com/getpaseo/paseo/pull/5653) by [@3ae3ae](https://github.com/3ae3ae))
- Fixed PR comments with linked pictures showing raw HTML tags and losing the image link ([#5968](https://github.com/getpaseo/paseo/pull/5968))
- Fixed text typed by the browser tool appearing in your message box instead of the browser tab ([#6207](https://github.com/getpaseo/paseo/pull/6207))
- Fixed Astro expressions losing their colors after a nested template string ([#6219](https://github.com/getpaseo/paseo/pull/6219))
- Fixed downloading files whose names contain non-ASCII characters ([#6278](https://github.com/getpaseo/paseo/pull/6278), [#6281](https://github.com/getpaseo/paseo/pull/6281) by [@dillonzq](https://github.com/dillonzq), [@jasonhnd](https://github.com/jasonhnd))
- Fixed the PR panel, sidebar workspace status, and "Worked for" line showing English in other app languages ([#6196](https://github.com/getpaseo/paseo/pull/6196), [#6208](https://github.com/getpaseo/paseo/pull/6208), [#6225](https://github.com/getpaseo/paseo/pull/6225) by [@dillonzq](https://github.com/dillonzq))
- Fixed French translations that read as word-for-word machine translation ([#6004](https://github.com/getpaseo/paseo/pull/6004) by [@fxlelouarn](https://github.com/fxlelouarn))
- Fixed the desktop window not dragging from the workspace header after scrolling a long chat ([#5233](https://github.com/getpaseo/paseo/pull/5233) by [@Zhou-Ruichen](https://github.com/Zhou-Ruichen))
- Fixed opening an agent on a touch screen in the desktop layout raising the on-screen keyboard ([#5477](https://github.com/getpaseo/paseo/pull/5477) by [@dinhphieu](https://github.com/dinhphieu))
- Fixed Option+arrow, Cmd+arrow, and Cmd+Backspace line editing in the macOS terminal ([#3339](https://github.com/getpaseo/paseo/pull/3339) by [@gpambrozio](https://github.com/gpambrozio))
- Fixed the daemon freezing when an Add Project directory search reached a folder whose read never returns ([#6029](https://github.com/getpaseo/paseo/pull/6029), [#6041](https://github.com/getpaseo/paseo/pull/6041) by [@lardissone](https://github.com/lardissone))
- Fixed a new worktree workspace being archived when its `paseo.json` cannot be parsed ([#6036](https://github.com/getpaseo/paseo/pull/6036) by [@3ae3ae](https://github.com/3ae3ae))
- Fixed workspace script status not updating in other connected clients ([#6007](https://github.com/getpaseo/paseo/pull/6007) by [@swbiggart](https://github.com/swbiggart))
- Fixed agents and terminals inheriting the voice library path, which truncated Git Bash's PATH on Windows ([#5987](https://github.com/getpaseo/paseo/pull/5987) by [@hanh9898](https://github.com/hanh9898))
- Fixed dictation failing until the model was deleted by hand when the daemon stopped while extracting a local speech model ([#6210](https://github.com/getpaseo/paseo/pull/6210) by [@3ae3ae](https://github.com/3ae3ae))
- Fixed macOS hosts showing as `UNKNOWN` when the network supplies no hostname ([#5922](https://github.com/getpaseo/paseo/pull/5922))
- Fixed `paseo daemon status` reporting a daemon in a Linux VM as stopped after the host wakes from sleep ([#6279](https://github.com/getpaseo/paseo/pull/6279))
- Fixed relay reconnects being ignored after a relay connection stalled before its handshake ([#5648](https://github.com/getpaseo/paseo/pull/5648) by [@3ae3ae](https://github.com/3ae3ae))
- Fixed `paseo daemon run` exiting with "Daemon failed to start" when the program that launched it stops reading its output ([#6117](https://github.com/getpaseo/paseo/pull/6117))
- Fixed CLI commands crashing with `EPIPE`, and the Windows desktop app showing an error dialog, when their output stops being read ([#6097](https://github.com/getpaseo/paseo/pull/6097))
- Fixed daemon self-update on a linked global install giving the wrong reason for refusing ([#6095](https://github.com/getpaseo/paseo/pull/6095))
- Fixed daemon self-update failing for an npm install under a prefix other than npm's global prefix ([#5649](https://github.com/getpaseo/paseo/pull/5649) by [@3ae3ae](https://github.com/3ae3ae))
- Fixed opening an archived agent whose worktree was removed showing "Workspace unavailable" when the workspace had no recorded branch ([#5694](https://github.com/getpaseo/paseo/pull/5694))
- Fixed a failed send to an archived agent whose directory was removed taking it out of History ([#6255](https://github.com/getpaseo/paseo/pull/6255))
- Fixed a host's version staying stale on the host page after its daemon restarts ([#5351](https://github.com/getpaseo/paseo/pull/5351) by [@bashrusakh](https://github.com/bashrusakh))
- Fixed Remote SSH hosts failing to connect to a password-protected daemon, with a new Daemon password field ([#6081](https://github.com/getpaseo/paseo/pull/6081) by [@royenheart](https://github.com/royenheart))
- Fixed removing a host during its first connection attempt not stopping the connection ([#5722](https://github.com/getpaseo/paseo/pull/5722))
- Fixed a file upload started while reconnecting failing with `Connection changed during file upload` ([#5585](https://github.com/getpaseo/paseo/pull/5585))
- Fixed the centered New workspace form collapsing and overlapping when the keyboard opens on tablets ([#6093](https://github.com/getpaseo/paseo/pull/6093) by [@colonelpanic8](https://github.com/colonelpanic8))
- Fixed the Android sidebar jumping back to the top when reopened after selecting a workspace ([#6058](https://github.com/getpaseo/paseo/pull/6058))
- Fixed tapping the context ring and long-pressing a workspace tab doing nothing on native tablets ([#5713](https://github.com/getpaseo/paseo/pull/5713) by [@JichenZhang](https://github.com/JichenZhang))
- Fixed iPad chat text keeping its old width after the pane resizes ([#5716](https://github.com/getpaseo/paseo/pull/5716))
- Fixed the context ring filling from three o'clock instead of twelve on web and desktop ([#5598](https://github.com/getpaseo/paseo/pull/5598))
- Fixed browser annotation screenshots capturing the wrong region when the app is zoomed ([#5703](https://github.com/getpaseo/paseo/pull/5703))
- Fixed the desktop app launching a `daemon status` process every second when no local daemon runs ([#5636](https://github.com/getpaseo/paseo/pull/5636))
- Fixed the `/` menu listing `/clear` and `/exit` in a draft before a project or model is chosen ([#5594](https://github.com/getpaseo/paseo/pull/5594) by [@colonelpanic8](https://github.com/colonelpanic8))
- Fixed `paseo agent delete --all` and `--cwd` leaving archived agents behind ([#6027](https://github.com/getpaseo/paseo/pull/6027) by [@3ae3ae](https://github.com/3ae3ae))
- Fixed `paseo agent` commands reporting a generic failure instead of `AGENT_NOT_FOUND` for an unknown agent ID ([#6053](https://github.com/getpaseo/paseo/pull/6053))
- Fixed `paseo agent open` opening Desktop and exiting 0 for an agent that does not exist ([#5727](https://github.com/getpaseo/paseo/pull/5727))
- Fixed `paseo restart` exiting with `RESTART_NOT_CONFIRMED` when provider checks take more than a second ([#6009](https://github.com/getpaseo/paseo/pull/6009))
- Fixed `paseo schedule update --no-max-runs` and `--no-expires-in` failing before reaching the daemon ([#5973](https://github.com/getpaseo/paseo/pull/5973) by [@Mar-garet](https://github.com/Mar-garet))
- Fixed `daemon.log` saying nothing when a resumed Claude agent's transcript is missing or cannot be read ([#5818](https://github.com/getpaseo/paseo/pull/5818) by [@gabrielgiordan](https://github.com/gabrielgiordan))
- Fixed reloading a plugin adding `[System Error] Provider connection closed` to finished chats on its provider ([#5579](https://github.com/getpaseo/paseo/pull/5579))
- Fixed `paseo plugin add .` looking for the plugin in the daemon's directory instead of the CLI's ([#6239](https://github.com/getpaseo/paseo/pull/6239))
- Fixed plugin settings screens on desktop having no way back to the Plugins page ([#5620](https://github.com/getpaseo/paseo/pull/5620))
- Fixed plugin client code failing to import npm packages that declare only `main` or `module` ([#5838](https://github.com/getpaseo/paseo/pull/5838))
- Fixed the SDK's `send()` and `run()` rejecting `activeTurnBehavior` in TypeScript ([#5605](https://github.com/getpaseo/paseo/pull/5605) by [@wjxdy](https://github.com/wjxdy))
- Fixed bundling `@getpaseo/client` from npm failing with `Could not resolve "@getpaseo/relay/e2ee"` ([#5815](https://github.com/getpaseo/paseo/pull/5815))

- Fixed OpenCode v2 turns longer than five minutes failing with `UND_ERR_HEADERS_TIMEOUT` ([#5674](https://github.com/getpaseo/paseo/pull/5674))
- Fixed the context meter staying empty during OpenCode v2 turns and disappearing after them ([#5710](https://github.com/getpaseo/paseo/pull/5710) by [@mcowger](https://github.com/mcowger))
- Fixed OpenCode v2 question cards showing only the header and offering no typed answer ([#5679](https://github.com/getpaseo/paseo/pull/5679))
- Fixed OpenCode v2 patch edits from GPT models showing as a raw Patch card instead of an edit diff ([#5696](https://github.com/getpaseo/paseo/pull/5696))
- Fixed completed OpenCode v2 edits showing no diff ([#5609](https://github.com/getpaseo/paseo/pull/5609))

- Fixed OpenCode chats failing with "Variant unavailable" after switching to a model without the selected thinking level ([#5587](https://github.com/getpaseo/paseo/pull/5587))
- Fixed rewinding a Codex chat dropping its custom provider and Paseo tools ([#5345](https://github.com/getpaseo/paseo/pull/5345) by [@zbaibg](https://github.com/zbaibg))
- Fixed streamed replies joining lines of code blocks and Mermaid diagrams until the chat reloads ([#5577](https://github.com/getpaseo/paseo/pull/5577))
- Fixed a subagent opened from a split pane opening in a different pane ([#5451](https://github.com/getpaseo/paseo/pull/5451))
- Fixed archiving a custom Codex provider's agent leaving its session in Import session ([#5572](https://github.com/getpaseo/paseo/pull/5572))
- Fixed the `/` menu of a custom Codex provider with its own `CODEX_HOME` listing the daemon's prompts instead of its own ([#5450](https://github.com/getpaseo/paseo/pull/5450))
- Fixed a background `send_agent_prompt` returning `idle` for a prompt the agent accepted ([#5386](https://github.com/getpaseo/paseo/pull/5386))
- Fixed Windows file-link tooltips showing the full path for files inside the workspace ([#1987](https://github.com/getpaseo/paseo/pull/1987))
- Fixed terminal profiles that run `cursor-agent` showing the generic terminal icon ([#5379](https://github.com/getpaseo/paseo/pull/5379))

- Fixed direct connections failing when the daemon password contains spaces or characters such as `@` or `/` ([#5393](https://github.com/getpaseo/paseo/pull/5393))
- Fixed existing OpenCode agents failing with `ECONNREFUSED` after the OpenCode server restarts ([#5338](https://github.com/getpaseo/paseo/pull/5338))
- Fixed messages OpenCode adds on its own appearing in the chat as if the user typed them ([#5434](https://github.com/getpaseo/paseo/pull/5434))
- Fixed the daemon stopping when `daemon.log` cannot be written, such as on a full disk ([#5445](https://github.com/getpaseo/paseo/pull/5445))
- Fixed the daemon crashing when opening an archived ACP agent whose worktree was removed ([#5439](https://github.com/getpaseo/paseo/pull/5439) by [@qinkangdeid](https://github.com/qinkangdeid))
- Fixed existing workspaces missing from the sidebar after the app starts, including after later restarts ([#5394](https://github.com/getpaseo/paseo/pull/5394))
- Fixed agents on a custom Claude provider with its own `CLAUDE_CONFIG_DIR` opening with an empty chat after a daemon restart ([#5437](https://github.com/getpaseo/paseo/pull/5437))
- Fixed a custom Codex provider's sessions missing from Import session ([#5446](https://github.com/getpaseo/paseo/pull/5446))
- Fixed Update daemon and Restart in host settings failing when a provider's version check takes over 1.5s ([#5372](https://github.com/getpaseo/paseo/pull/5372))
- Fixed `paseo --host <other daemon> run` failing with "Caller agent not found" from inside an agent session ([#5392](https://github.com/getpaseo/paseo/pull/5392))
- Fixed a Pi chat rewind going back further than the picked message after an earlier rewind ([#5383](https://github.com/getpaseo/paseo/pull/5383))
- Fixed a Pi chat rewind being undone when the daemon restarts ([#5432](https://github.com/getpaseo/paseo/pull/5432))
- Fixed Pi agents started without a model ignoring Pi's configured default model ([#5343](https://github.com/getpaseo/paseo/pull/5343))
- Fixed project skills in a new agent's `/` menu staying stale after the checkout switches branches ([#5415](https://github.com/getpaseo/paseo/pull/5415))
- Fixed slash commands missing from a new agent's `/` menu on custom ACP providers ([#5411](https://github.com/getpaseo/paseo/pull/5411))
- Fixed a parent agent receiving a child's finish notification twice after prompting the running child ([#5407](https://github.com/getpaseo/paseo/pull/5407))
- Fixed a blocking `send_agent_prompt` that outlasts its 30s wait never notifying the caller when the child finishes ([#5347](https://github.com/getpaseo/paseo/pull/5347))
- Fixed OSC 8 terminal links showing a navigation prompt and opening a blank Paseo window ([#5388](https://github.com/getpaseo/paseo/pull/5388) by [@liujin0506](https://github.com/liujin0506))
- Fixed the Theme menu not scrolling when plugin themes overflow the window ([#5374](https://github.com/getpaseo/paseo/pull/5374))
- Fixed a message from today's weekday last week showing only the weekday instead of its date ([#5341](https://github.com/getpaseo/paseo/pull/5341))
- Fixed `paseo daemon set-password` exiting silently when stdin is not a terminal ([#5358](https://github.com/getpaseo/paseo/pull/5358))

- Fixed the daemon becoming unresponsive when ignored directories appear after a workspace opens ([c3e1e08](https://github.com/getpaseo/paseo/commit/c3e1e084a068e5895710c43b034ced8ebef256e8) by [@Marcus172](https://github.com/Marcus172))
- Fixed daemon memory growing after client connections close ([9978988](https://github.com/getpaseo/paseo/commit/9978988e35409a018a52d0d7646f18b51e562346))
- Fixed a project folder ending in a space crashing the app on load ([#5205](https://github.com/getpaseo/paseo/pull/5205) by [@L4XB](https://github.com/L4XB))
- Fixed workspace labels missing when an agent screen opens before the sidebar ([#5079](https://github.com/getpaseo/paseo/pull/5079) by [@morven-ai](https://github.com/morven-ai))
- Fixed workspaces disappearing when their disk or network share is unavailable ([#5227](https://github.com/getpaseo/paseo/pull/5227))
- Fixed a failed session import making an archived worktree impossible to restore ([#5238](https://github.com/getpaseo/paseo/pull/5238))
- Fixed archived agent logs failing after Paseo removes their worktree ([#5229](https://github.com/getpaseo/paseo/pull/5229))
- Fixed a newly created branch pushing to the default branch through an inherited upstream ([#5249](https://github.com/getpaseo/paseo/pull/5249))
- Fixed fork checkout pull requests disappearing from the workspace after refresh ([#5221](https://github.com/getpaseo/paseo/pull/5221))
- Fixed agent-created local workspaces accepting a missing path or file ([#5322](https://github.com/getpaseo/paseo/pull/5322))
- Fixed chat uploads replacing valid characters in original file names with underscores ([#5317](https://github.com/getpaseo/paseo/pull/5317))
- Fixed multi-select questions dropping checked options or a typed Other answer ([#5320](https://github.com/getpaseo/paseo/pull/5320) by [@ThePharmer](https://github.com/ThePharmer))
- Fixed Android Back leaving the screen while a bottom sheet is open ([#5245](https://github.com/getpaseo/paseo/pull/5245))
- Fixed voice mode playing the thinking tone between spoken reply segments ([#5281](https://github.com/getpaseo/paseo/pull/5281))
- Fixed a Claude slash command sent with an attachment reaching Claude as plain text ([#5240](https://github.com/getpaseo/paseo/pull/5240) by [@joecorkerton](https://github.com/joecorkerton))
- Fixed Claude rewind after a turn that received no response ([#5285](https://github.com/getpaseo/paseo/pull/5285))
- Fixed Claude rewind after a turn containing subagent messages ([#5289](https://github.com/getpaseo/paseo/pull/5289))
- Fixed repeated agent history after refresh when a durable timeline store is configured ([#5286](https://github.com/getpaseo/paseo/pull/5286))
- Fixed an OMP custom message ending a turn before the provider finished ([#3258](https://github.com/getpaseo/paseo/pull/3258))
- Fixed a stopped OMP turn appearing as a failed turn ([#5243](https://github.com/getpaseo/paseo/pull/5243))
- Fixed Stop refusing to settle a Pi or OMP agent whose runtime has exited ([#5235](https://github.com/getpaseo/paseo/pull/5235))
- Fixed OpenCode agents ignoring their configured permission rules ([#5296](https://github.com/getpaseo/paseo/pull/5296) by [@gurvancampion](https://github.com/gurvancampion))
- Fixed Codex Default and Read-only modes sending approval requests to Auto-review ([#5239](https://github.com/getpaseo/paseo/pull/5239) by [@HMWCS](https://github.com/HMWCS))
- Fixed Cursor agent creation after switching from a Fast model to one without Fast ([#5274](https://github.com/getpaseo/paseo/pull/5274) by [@gengjiawen](https://github.com/gengjiawen))
- Fixed the Fast control missing for GPT-6 Sol and GPT-6 Luna in Codex ([#5273](https://github.com/getpaseo/paseo/pull/5273) by [@basilk15](https://github.com/basilk15), [@colonelpanic8](https://github.com/colonelpanic8))
- Fixed Claude's configured Fable model missing from the model picker ([#5326](https://github.com/getpaseo/paseo/pull/5326) by [@noahg9](https://github.com/noahg9))
- Fixed ACP terminals started by the daemon using the wrong agent identity ([#5248](https://github.com/getpaseo/paseo/pull/5248))
- Fixed an agent's completed plugin session appearing failed after a daemon restart ([#5253](https://github.com/getpaseo/paseo/pull/5253))
- Fixed plugin reload crashing its subprocess while a provider session closes ([#5231](https://github.com/getpaseo/paseo/pull/5231))
- Fixed a failed plugin provider request crashing the daemon ([#5298](https://github.com/getpaseo/paseo/pull/5298))
- Fixed Hub executions being unable to title workspaces they create ([#5302](https://github.com/getpaseo/paseo/pull/5302))
- Fixed an invalid schedule file preventing the daemon from starting ([#5301](https://github.com/getpaseo/paseo/pull/5301))
- Fixed an empty `paseo.pid` preventing the daemon from starting ([#5306](https://github.com/getpaseo/paseo/pull/5306))
- Fixed a recycled daemon PID preventing startup after a reboot ([#5277](https://github.com/getpaseo/paseo/pull/5277))
- Fixed daemon startup failing on `config.json` saved with a UTF-8 byte order mark ([#5315](https://github.com/getpaseo/paseo/pull/5315))
- Fixed background daemon startup errors missing from the reported log file ([#5332](https://github.com/getpaseo/paseo/pull/5332))
- Fixed CLI errors for invalid `config.json` omitting the file and failing field ([#5337](https://github.com/getpaseo/paseo/pull/5337))
- Fixed the CLI suggesting daemon startup after a password rejection ([#5310](https://github.com/getpaseo/paseo/pull/5310))
- Fixed Open in editor missing for a password-protected desktop daemon ([#5335](https://github.com/getpaseo/paseo/pull/5335))
- Fixed `paseo permit ls --json` shortening request IDs needed by `permit allow` and `permit deny` ([#5305](https://github.com/getpaseo/paseo/pull/5305))
- Fixed a replica cache read spinning when its store keeps rejecting writes ([#5290](https://github.com/getpaseo/paseo/pull/5290))
- Fixed the MiniMax card showing a raw error for an inactive token subscription ([#5258](https://github.com/getpaseo/paseo/pull/5258))
- Fixed modified Backspace being rejected as a custom shortcut ([#5224](https://github.com/getpaseo/paseo/pull/5224))
- Fixed multi-step shortcuts failing when the app updates between steps ([#5255](https://github.com/getpaseo/paseo/pull/5255) by [@colonelpanic8](https://github.com/colonelpanic8))
- Fixed multi-step shortcuts failing when the second step holds a modifier ([#5272](https://github.com/getpaseo/paseo/pull/5272))
- Fixed rebound pane-focus shortcuts failing while typing ([#5287](https://github.com/getpaseo/paseo/pull/5287))

- Fixed the sidebar keeping only recently changed conversations after the app reconnects to a daemon ([#5189](https://github.com/getpaseo/paseo/pull/5189) by [@bagutzu](https://github.com/bagutzu))
- Fixed Import session offering only the newest 100 Codex conversations ([#5174](https://github.com/getpaseo/paseo/pull/5174) by [@3ae3ae](https://github.com/3ae3ae))
- Fixed a Claude model whose ID carries a minor version, such as Opus 5.5, reverting to its major version in the composer once a turn finished ([#5200](https://github.com/getpaseo/paseo/pull/5200))

- Fixed the daemon exhausting its heap in long conversations with cumulative tool output ([#4838](https://github.com/getpaseo/paseo/pull/4838))
- Fixed repeated submissions creating several workspaces or agents for one intent ([#4442](https://github.com/getpaseo/paseo/pull/4442))
- Fixed a crash loop after closing the last content tab in a workspace ([#4844](https://github.com/getpaseo/paseo/pull/4844))
- Fixed New Agent crashing when an enabled provider published duplicate model IDs ([#4839](https://github.com/getpaseo/paseo/pull/4839))
- Fixed long drafts growing behind the chat header on Android and iOS ([#4824](https://github.com/getpaseo/paseo/pull/4824))
- Fixed the Android composer growing taller when the keyboard closed ([#4902](https://github.com/getpaseo/paseo/pull/4902))
- Fixed the Android composer keeping its height after hold-to-delete emptied a draft ([#4946](https://github.com/getpaseo/paseo/pull/4946))
- Fixed New workspace setup content not moving up as the composer grows ([#4973](https://github.com/getpaseo/paseo/pull/4973))
- Fixed the Android timeline scrolling away when tapping or selecting text in a chat ([#5013](https://github.com/getpaseo/paseo/pull/5013))
- Fixed Paste image failing before an attachment reached the composer on Android ([#4758](https://github.com/getpaseo/paseo/pull/4758))
- Fixed provider and model pickers not responding on Android tablets ([#4845](https://github.com/getpaseo/paseo/pull/4845) by [@cjcrjc](https://github.com/cjcrjc), [@mkuhl](https://github.com/mkuhl))
- Fixed Linux desktop packages launching without the Chromium sandbox ([#4447](https://github.com/getpaseo/paseo/pull/4447))
- Fixed `paseo daemon stop` shutting down a daemon other than the selected one ([#4575](https://github.com/getpaseo/paseo/pull/4575))
- Fixed restored archived workspaces showing empty Changes and Commits ([#4926](https://github.com/getpaseo/paseo/pull/4926))
- Fixed a rejected plan appearing below the follow-up message that rejected it ([#4756](https://github.com/getpaseo/paseo/pull/4756))
- Fixed Cmd/Ctrl+F not opening chat Find while the composer had focus ([#4991](https://github.com/getpaseo/paseo/pull/4991))
- Fixed the linked pull request going undetected when a branch remote is a repository URL ([#4862](https://github.com/getpaseo/paseo/pull/4862))
- Fixed a plugin's filtered agent list replacing the app's own directory subscription ([#4596](https://github.com/getpaseo/paseo/pull/4596))
- Fixed an updated app rejecting daemons that lack independent subscriptions ([#4737](https://github.com/getpaseo/paseo/pull/4737))
- Fixed workspace and agent creation failing or leaving agent titles at "Loading…" on 0.8.0 and older daemons ([#4895](https://github.com/getpaseo/paseo/pull/4895))
- Fixed Cursor models showing another model's thinking options ([#4180](https://github.com/getpaseo/paseo/pull/4180) by [@fidelix](https://github.com/fidelix))
- Fixed Pi model pickers offering thinking levels the model does not support ([#4413](https://github.com/getpaseo/paseo/pull/4413) by [@mcowger](https://github.com/mcowger), [@therainisme](https://github.com/therainisme))
- Fixed Pi sessions reporting the requested thinking level instead of the one Pi applied ([#4413](https://github.com/getpaseo/paseo/pull/4413))
- Fixed voice-chat user messages showing the internal prompt wrapper instead of the transcript ([#4927](https://github.com/getpaseo/paseo/pull/4927))
- Fixed History and Command Center search matching a query assembled from letters in separate words ([#4945](https://github.com/getpaseo/paseo/pull/4945))
- Fixed workspace titles truncating early on touch layouts behind hidden diff stats ([#4698](https://github.com/getpaseo/paseo/pull/4698))
- Fixed the Explorer showing `+0 -0` and "No changes" while being dragged open ([#4861](https://github.com/getpaseo/paseo/pull/4861))
- Fixed the reconnect toast restarting its entrance animation when opening a saved chat ([#4925](https://github.com/getpaseo/paseo/pull/4925))
- Fixed raised shadows around Android file rows in the changed-files sheet ([#4898](https://github.com/getpaseo/paseo/pull/4898))

### From Paseo — Plugins

- Changed `paseo plugin add owner/slug` to install the reviewed plugin from the plugin registry, so local directories need a path such as `./slug` and direct GitHub installs need `github:owner/repo` ([#6224](https://github.com/getpaseo/paseo/pull/6224))
- Added [screens and sidebar header and footer items](https://paseo.sh/docs/plugins/reference#screens-and-sidebar-items) to the plugin SDK ([#5685](https://github.com/getpaseo/paseo/pull/5685))
- Added usage sources to the plugin SDK ([#5465](https://github.com/getpaseo/paseo/pull/5465), [#5876](https://github.com/getpaseo/paseo/pull/5876))
- Added `spawnProcess()`, `execCommand()`, and `terminateProcess()` to the plugin SDK for launching CLIs, including Windows `.cmd` and `.bat` scripts ([#6151](https://github.com/getpaseo/paseo/pull/6151))
- Added `client.playAudio()` to the plugin SDK for playing audio on every client ([#5976](https://github.com/getpaseo/paseo/pull/5976))
- Added an `agent.closed` plugin lifecycle event ([#5971](https://github.com/getpaseo/paseo/pull/5971) by [@ilteoood](https://github.com/ilteoood))
- Added command and environment overrides and availability diagnostics for plugin providers ([#5707](https://github.com/getpaseo/paseo/pull/5707))
- Added a display name, icon, screenshots, and videos to the plugin manifest ([#6263](https://github.com/getpaseo/paseo/pull/6263))
- Added an `OVERVIEW.md` template to `paseo plugin init` for plugin registry listings ([#6226](https://github.com/getpaseo/paseo/pull/6226))

- Added plugin installation from npm, including scoped packages, versions, tags, and ranges ([#4975](https://github.com/getpaseo/paseo/pull/4975))
- Added `paseo plugin update` with `--all`, `--check`, and `--yes`, showing the current and proposed revision before approval ([#4975](https://github.com/getpaseo/paseo/pull/4975))
- Added each plugin's description, source, and installed revision to Settings → Plugins ([#4975](https://github.com/getpaseo/paseo/pull/4975))
- Added an optional `serverId` to `navigation.openAgent()` and `navigation.openWorkspace()` ([#4942](https://github.com/getpaseo/paseo/pull/4942))
- Added host discovery through `useHosts()` and host-targeted SDK clients through `getPaseoClient(serverId)` ([#4971](https://github.com/getpaseo/paseo/pull/4971))
- Added `openExternalUrl()` and `<ExternalLink>` for opening a URL outside Paseo ([#4972](https://github.com/getpaseo/paseo/pull/4972))
- Added `navigation.openBrowser()` for opening a URL in a workspace browser on desktop ([#4972](https://github.com/getpaseo/paseo/pull/4972))
- Added a server settings handle returned by `registerSettings()` with `read()` and `subscribe()` ([#4674](https://github.com/getpaseo/paseo/pull/4674) by [@mcowger](https://github.com/mcowger))
- Changed `assistant_message` transformers to receive the whole accumulated message on each update ([#4675](https://github.com/getpaseo/paseo/pull/4675) by [@mcowger](https://github.com/mcowger), [@jegork](https://github.com/jegork))
- Changed `tool_call` transformers to receive every original call before Overview groups them ([#4675](https://github.com/getpaseo/paseo/pull/4675))
- Fixed a plugin session losing its host API permanently after its heartbeat lease expired ([#4912](https://github.com/getpaseo/paseo/pull/4912) by [@gpambrozio](https://github.com/gpambrozio))
- Fixed plugin build commands failing with `spawn npm ENOENT` on Windows ([#4776](https://github.com/getpaseo/paseo/pull/4776) by [@ABorakati](https://github.com/ABorakati))
- Fixed ACP text chunks without a `messageId` splitting one reply into a message per chunk ([#4701](https://github.com/getpaseo/paseo/pull/4701) by [@L4XB](https://github.com/L4XB))
- Fixed nested provider subagents appearing as direct children of the root agent ([#4970](https://github.com/getpaseo/paseo/pull/4970))

### From Paseo — Changed

- Changed the context window details to show usage for the account the agent runs under, including custom `CLAUDE_CONFIG_DIR` and `CODEX_HOME` homes ([#5465](https://github.com/getpaseo/paseo/pull/5465))
- Changed the context window details on desktop to a hover card with Refresh ([#5975](https://github.com/getpaseo/paseo/pull/5975), [#6185](https://github.com/getpaseo/paseo/pull/6185))
- Changed the context window meter to show before an agent's first turn ([#6089](https://github.com/getpaseo/paseo/pull/6089))
- Changed Codex Fast to a Speed menu listing the Normal, Fast, and Ultrafast speeds each model offers, shown as a lightning bolt on desktop that turns yellow while Fast or Ultrafast is selected ([#5708](https://github.com/getpaseo/paseo/pull/5708), [#6152](https://github.com/getpaseo/paseo/pull/6152) by [@Nurshot](https://github.com/Nurshot))
- Changed Explorer tabs to work like workspace tabs, with a + menu, drag and drop, and Close for Files and Changes ([#5942](https://github.com/getpaseo/paseo/pull/5942))
- Changed Pi and OMP extension context to show as expandable tool rows instead of assistant text, and to hide Pi messages marked hidden ([#6090](https://github.com/getpaseo/paseo/pull/6090))
- Moved Import session from the sidebar footer to the New workspace screen ([#5805](https://github.com/getpaseo/paseo/pull/5805))
- Changed the sidebar workspace row to show last activity by default on new installs ([#6087](https://github.com/getpaseo/paseo/pull/6087))
- Changed compact sidebar footer buttons to 44×44 tap targets ([#6044](https://github.com/getpaseo/paseo/pull/6044))
- Changed new workspaces branched from `origin/main` or another remote branch to fetch that branch first ([#5788](https://github.com/getpaseo/paseo/pull/5788) by [@odoo-mvds](https://github.com/odoo-mvds))
- Changed Paseo's internal Claude agents for branch names, commit messages, and PR text to run with Claude hooks disabled ([#5750](https://github.com/getpaseo/paseo/pull/5750))
- Changed OMP approval mode changes to apply on the next idle relaunch, and to be refused during a turn ([#5550](https://github.com/getpaseo/paseo/pull/5550))
- Changed relative timestamps in agent, schedule, and Import session rows to keep advancing while on screen ([#5340](https://github.com/getpaseo/paseo/pull/5340))

- Changed the CLI and desktop app to connect to a password-protected daemon on the same machine without asking for the password ([#5393](https://github.com/getpaseo/paseo/pull/5393))
- Changed a host rejected for its password to show "Password required" or "Incorrect password" on the host and Connections pages ([#5393](https://github.com/getpaseo/paseo/pull/5393))
- Reorganized Settings into General, Sidebar, Chat, Terminal, Browser, and Open location pages ([#5459](https://github.com/getpaseo/paseo/pull/5459))

- Changed History search to keep results chronological in date buckets instead of reordering by relevance ([#4945](https://github.com/getpaseo/paseo/pull/4945))
- Changed workspace Restore to keep the archived agent selected, with its own Unarchive action ([#4736](https://github.com/getpaseo/paseo/pull/4736))
- Changed the workspace error screen's Retry to Reload, which reopens at the project picker ([#4598](https://github.com/getpaseo/paseo/pull/4598))
- Changed closing the last content tab to leave the New launcher instead of an unusable pane ([#4844](https://github.com/getpaseo/paseo/pull/4844))
- Changed `paseo daemon start` to read persistent configuration; removed configuration flags fail with migration instructions ([#4575](https://github.com/getpaseo/paseo/pull/4575))

### From Paseo — Improved

- Reduced background Git polling for repositories the watcher cannot observe ([#5170](https://github.com/getpaseo/paseo/pull/5170))
- Reduced Add Project directory search time on large home directories ([#5190](https://github.com/getpaseo/paseo/pull/5190))

- Bold, italics, strikethrough, inline code, and link labels stay formatted while a reply streams ([#4742](https://github.com/getpaseo/paseo/pull/4742))
- Reduced time to first voice audio from 4.80s to 0.95s on a three-sentence reply ([#4927](https://github.com/getpaseo/paseo/pull/4927))
- Reduced cold diff generation from 11.45s to 2.65s on a 213-file workspace ([#4676](https://github.com/getpaseo/paseo/pull/4676))
- Reduced desktop memory use, from 290.5 MiB to 152.1 MiB RSS in the Electron main process after loading daemon management ([#5007](https://github.com/getpaseo/paseo/pull/5007))
- Kept open chats subscribed across view eviction, app backgrounding, and reconnect ([#4863](https://github.com/getpaseo/paseo/pull/4863))
- Added reconnection and Updating messages status to the chat toast ([#4863](https://github.com/getpaseo/paseo/pull/4863))
- Kept the app responsive during large uploads by yielding between 128 KiB chunks ([#4958](https://github.com/getpaseo/paseo/pull/4958))
- Let resident browser pages idle between screenshots while the desktop window is hidden ([#4646](https://github.com/getpaseo/paseo/pull/4646))

## 0.8.1 - 2026-09-15

### Rambla — Added

- Added the Rambla side of write tool call diffs for ACP agents: when an agent reports what a whole-file write replaced, the write detail view renders a colored old-to-new diff. If an agent does not report it, this does nothing on its own.

### Rambla — Changed

- Renamed Paseo to Rambla throughout: CLI command, data directory, lock file, process titles, deep-link scheme, environment variables, NixOS service, desktop artifacts, domain, and repository URLs
- Changed package authorship and gave LICENSE both copyright lines, and updated SECURITY.md and the website's legal pages: data controller, governing law, legal identity, and contact addresses

### Rambla — Improved

- Streamed the Rambla side of the context meter for ACP agents: the daemon now forwards usage updates it used to discard
- Showed the session reset countdown to one more unit: days with hours, hours with minutes, minutes with seconds

### Rambla — Fixed

- Fixed the GLM agent never launching and never appearing in the provider list
- Fixed ACP agent whole-file writes showing the label "Edit" instead of "Write" on the tool call row
- Fixed the Z.ai quota panel reporting no usage at all; it now shows the GLM Coding Plan's 5-hour and weekly windows, and reads the token from glm-acp-agent's stored credentials, so no daemon environment variable is needed
- Fixed missing spaces around the product name in Spanish, French, and Arabic strings
- Fixed the in-app macOS updater requesting the old Paseo-named dmg after the packaged artifact was renamed to Rambla

> Rambla began as a fork of Paseo. For Paseo's own history before this
> release, see [PASEO-CHANGELOG.md](PASEO-CHANGELOG.md).
