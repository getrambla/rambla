# Changelog

## Unreleased

### Added

- 2026-09-24 - [8e9d363](https://github.com/getrambla/rambla/commit/8e9d36373f49608997378a3b58f8aec6e97c77bd) - [2026-09-22-feat-os-notification-toggle.md](plans/2026-09-22-feat-os-notification-toggle.md) - Added a settings switch that turns OS notifications off, hides the notifications card, and removes the refresh button.

### Fixed

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
