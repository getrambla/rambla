# Changelog

## Unreleased

### Added

- 2026-09-24 - [**\_\_\_**](https://github.com/getrambla/rambla/commit/**___**) - [2026-09-24-feat-user-adjustable-composer-height.md](plans/2026-09-24-feat-user-adjustable-composer-height.md) - Gave the composer a fixed, user-defined height: drag the top handle to resize (2-line floor, window-top ceiling), release to pin, double-tap to restore the 3-line default; content auto-grow removed.
- 2026-09-24 - [2f02b83](https://github.com/getrambla/rambla/commit/2f02b8312) - [2026-09-22-feat-os-notification-toggle.md](plans/2026-09-22-feat-os-notification-toggle.md) - Added a settings switch that turns OS notifications off, hides the notifications card, and removes the refresh button.

### Fixed

- 2026-09-26 - [de47f4f](https://github.com/getrambla/rambla/commit/de47f4fb8) - [2026-09-26-fix-composer-ios-bottom-spacing.md](plans/2026-09-26-fix-composer-ios-bottom-spacing.md) - Slimmed the composer's bottom spacing on iOS: smaller gap under the panel and above the controls, keyboard alignment kept.
- 2026-09-24 - [73aa827](https://github.com/getrambla/rambla/commit/73aa827) - [2026-09-24-fix-subagent-default-provider-model.md](plans/2026-09-24-fix-subagent-default-provider-model.md) - Fixed create_agent requiring a provider name: a subagent now inherits the caller's provider and model when none is named.
- 2026-09-24 - [5376d23](https://github.com/getrambla/rambla/commit/5376d23) - [2026-09-24-fix-ios-link-scroll-gate.md](plans/2026-09-24-fix-ios-link-scroll-gate.md) - Fixed lifting a finger off an assistant file link after scrolling the chat on iOS opening the link.
- 2026-09-24 - b7138f6 - (no plan) - Bump react-native-uitextview to 2.7.1 to improve a11y on iOS.

## 0.8.1 - 2026-09-15

### Added

- Added the Rambla side of write tool call diffs for ACP agents: when an agent reports what a whole-file write replaced, the write detail view renders a colored old-to-new diff. If an agent does not report it, this does nothing on its own.

### Changed

- Renamed Paseo to Rambla throughout: CLI command, data directory, lock file, process titles, deep-link scheme, environment variables, NixOS service, desktop artifacts, domain, and repository URLs
- Changed package authorship and gave LICENSE both copyright lines, and updated SECURITY.md and the website's legal pages: data controller, governing law, legal identity, and contact addresses

### Improved

- Streamed the Rambla side of the context meter for ACP agents: the daemon now forwards usage updates it used to discard
- Showed the session reset countdown to one more unit: days with hours, hours with minutes, minutes with seconds

### Fixed

- Fixed the GLM agent never launching and never appearing in the provider list
- Fixed ACP agent whole-file writes showing the label "Edit" instead of "Write" on the tool call row
- Fixed the Z.ai quota panel reporting no usage at all; it now shows the GLM Coding Plan's 5-hour and weekly windows, and reads the token from glm-acp-agent's stored credentials, so no daemon environment variable is needed
- Fixed missing spaces around the product name in Spanish, French, and Arabic strings
- Fixed the in-app macOS updater requesting the old Paseo-named dmg after the packaged artifact was renamed to Rambla
