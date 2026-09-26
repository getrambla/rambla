# Changelog

Rambla is a fork of Paseo. Each release lists Rambla's own changes first, followed by the Paseo changes included in that release.

## Unreleased

### Rambla — Added

- 2026-09-24 - [**\_\_\_**](https://github.com/getrambla/rambla/commit/**___**) - [2026-09-24-feat-user-adjustable-composer-height.md](plans/2026-09-24-feat-user-adjustable-composer-height.md) - Gave the composer a fixed, user-defined height: drag the top handle to resize (2-line floor, window-top ceiling), release to pin, double-tap to restore the 3-line default; content auto-grow removed.
- 2026-09-24 - [2f02b83](https://github.com/getrambla/rambla/commit/2f02b8312) - [2026-09-22-feat-os-notification-toggle.md](plans/2026-09-22-feat-os-notification-toggle.md) - Added a settings switch that turns OS notifications off, hides the notifications card, and removes the refresh button.

### Rambla — Fixed

- 2026-09-24 - [73aa827](https://github.com/getrambla/rambla/commit/73aa827) - [2026-09-24-fix-subagent-default-provider-model.md](plans/2026-09-24-fix-subagent-default-provider-model.md) - Fixed create_agent requiring a provider name: a subagent now inherits the caller's provider and model when none is named.
- 2026-09-24 - [5376d23](https://github.com/getrambla/rambla/commit/5376d23) - [2026-09-24-fix-ios-link-scroll-gate.md](plans/2026-09-24-fix-ios-link-scroll-gate.md) - Fixed lifting a finger off an assistant file link after scrolling the chat on iOS opening the link.
- 2026-09-24 - b7138f6 - (no plan) - Bump react-native-uitextview to 2.7.1 to improve a11y on iOS.

### From Paseo — Added

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

### From Paseo — Fixed

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

- Changed History search to keep results chronological in date buckets instead of reordering by relevance ([#4945](https://github.com/getpaseo/paseo/pull/4945))
- Changed workspace Restore to keep the archived agent selected, with its own Unarchive action ([#4736](https://github.com/getpaseo/paseo/pull/4736))
- Changed the workspace error screen's Retry to Reload, which reopens at the project picker ([#4598](https://github.com/getpaseo/paseo/pull/4598))
- Changed closing the last content tab to leave the New launcher instead of an unusable pane ([#4844](https://github.com/getpaseo/paseo/pull/4844))
- Changed `paseo daemon start` to read persistent configuration; removed configuration flags fail with migration instructions ([#4575](https://github.com/getpaseo/paseo/pull/4575))

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
