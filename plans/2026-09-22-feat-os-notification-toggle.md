# feat: switch to turn off system notifications

## Provenance

- main: `0dc520cf8` — 2026-09-23
- upstream-rebrand: `61b044d8b` — 2026-09-21
- upstream/main: `135a3b4c9` (untagged) — 2026-09-21

## Scope

**In scope:**

1. An on/off switch on the Settings > Notifications heading, in
   `SettingsSection`'s `trailing` slot.
2. Off stops Rambla firing OS notifications.
3. Off hides the card under the heading; the heading and switch stay.
4. The refresh button moves off the heading to the right edge of the
   permission row, beside the status pill.

**Not in scope:**

- The browser. The section returns null off Electron
  ([`desktop-notifications-section.tsx:82-84`](../packages/app/src/desktop/components/desktop-notifications-section.tsx#L82-L84)), so there is nothing to switch
  there.
- Mobile/native. No Notifications section, and `sendOsNotification` returns
  false on native ([`os-notifications.ts:168-170`](../packages/app/src/utils/os-notifications.ts#L168-L170)).
- Dock and taskbar badges, and in-app indicators. The switch suppresses OS
  notifications only: the callers of `sendOsNotification` are
  [`session-context.tsx:312`](../packages/app/src/contexts/session-context.tsx#L312), [`session-context.tsx:713`](../packages/app/src/contexts/session-context.tsx#L713) and
  [`use-desktop-permissions.ts:128`](../packages/app/src/desktop/permissions/use-desktop-permissions.ts#L128), and nothing else.
- The play-sound row's behavior, and any preference beyond the one switch.
- The test-notification button
  ([`use-desktop-permissions.ts:128`](../packages/app/src/desktop/permissions/use-desktop-permissions.ts#L128)): it hides with the card
  when off, and pressing it is an explicit request, so it stays ungated and
  its file untouched.

## Goal

One switch on the Settings > Notifications heading in the desktop app turns OS
notifications off; off hides the card below it, and refresh moves onto the
permission row beside the status pill.

## Merge conflict mitigation

Permanent fork of upstream Paseo; nothing goes upstream, upstream merges in
weekly. Code below follows the fork's placement rules.

**New module:** none. Every change is an edit inside an upstream file.

**Upstream files touched:**

| File                                                                                                            | Edit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Upstream activity                                               | Tag                     |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------- |
| [`storage.ts`](../packages/app/src/hooks/use-settings/storage.ts)                                               | `notificationsEnabled` in `AppSettings` (beside [`storage.ts:90`](../packages/app/src/hooks/use-settings/storage.ts#L90)), `DEFAULT_CLIENT_SETTINGS` (beside [`storage.ts:143`](../packages/app/src/hooks/use-settings/storage.ts#L143)), `StoredAppSettingsSchema` (beside [`storage.ts:238`](../packages/app/src/hooks/use-settings/storage.ts#L238))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | last touched 2026-09-14, 30 times this year                     | `RAMBLA-FORK: feature:` |
| [`session-context.tsx`](../packages/app/src/contexts/session-context.tsx)                                       | 4 sites: `useSettings` import at the end of the import block; the selector, a ref and its per-render assignment beside `appStateRef` ([`session-context.tsx:238`](../packages/app/src/contexts/session-context.tsx#L238)); a braced guard before `sendOsNotification` at [`session-context.tsx:312`](../packages/app/src/contexts/session-context.tsx#L312); the same before [`session-context.tsx:713`](../packages/app/src/contexts/session-context.tsx#L713)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | last touched 2026-09-21, 153 times this year                    | `RAMBLA-FORK: feature:` |
| [`desktop-notifications-section.tsx`](../packages/app/src/desktop/components/desktop-notifications-section.tsx) | `useSettings` import at the end of the import block; one block after `permissionLabels` ([`desktop-notifications-section.tsx:73-80`](../packages/app/src/desktop/components/desktop-notifications-section.tsx#L73-L80)) and above upstream's early return, holding an aliased destructure of the no-argument `useSettings()` — the app store under `appSettings`, its updater under `updateAppSettings` — because [`desktop-notifications-section.tsx:22`](../packages/app/src/desktop/components/desktop-notifications-section.tsx#L22) already binds `settings` and `updateSettings` to `useDesktopSettings()` and upstream's `handlePlaySoundChange` and play-sound `Switch` keep using those — a `handleOsNotificationsChange` `useCallback` shaped like `handlePlaySoundChange` ([`desktop-notifications-section.tsx:42-49`](../packages/app/src/desktop/components/desktop-notifications-section.tsx#L42-L49)), and a `notificationsSwitch` `useMemo` wrapping the `Switch` upstream writes at [`desktop-notifications-section.tsx:103-109`](../packages/app/src/desktop/components/desktop-notifications-section.tsx#L103-L109); an early return after upstream's own at [`desktop-notifications-section.tsx:82-84`](../packages/app/src/desktop/components/desktop-notifications-section.tsx#L82-L84); `trailing` at [`desktop-notifications-section.tsx:89`](../packages/app/src/desktop/components/desktop-notifications-section.tsx#L89) takes the switch; the `DesktopPermissionRow` call at [`desktop-notifications-section.tsx:91-97`](../packages/app/src/desktop/components/desktop-notifications-section.tsx#L91-L97) takes the refresh button | last touched 2026-09-06, 2 times this year (created 2026-08-08) | `RAMBLA-FORK: feature:` |
| [`desktop-permission-row.tsx`](../packages/app/src/desktop/components/desktop-permission-row.tsx)               | `trailing?: ReactNode` prop ([`desktop-permission-row.tsx:10`](../packages/app/src/desktop/components/desktop-permission-row.tsx#L10)), destructure ([`desktop-permission-row.tsx:33`](../packages/app/src/desktop/components/desktop-permission-row.tsx#L33)), rendered in the row, and a `ReactNode` type import at the end of the import block                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | last touched 2026-08-17, 9 times this year                      | `RAMBLA-FORK: feature:` |

**Why this shape:** every change is a minimal in-place edit at a cold seam
(placement rule 4); copying the two UI files into `*.rambla.tsx` modules would
orphan upstream's future work on a notifications UI it has already reworked
once, and anything wider would move our lines into the middle of upstream's.
The gates read a ref rather than joining a dependency array because those deps
are frozen ([`session-context.tsx:318`](../packages/app/src/contexts/session-context.tsx#L318)) — widening them would resubscribe every feed on each toggle.

**Tests:** all new; upstream tests modified: none.
`desktop/components/desktop-permission-row.rambla.test.tsx` — the new prop
renders in the row. `desktop/components/desktop-notifications-section.rambla.test.tsx` — renders
upstream's component: the switch reflects and writes the preference; off, the
card and alerts are gone with heading and switch present; on, the refresh
button sits in the permission row; it imports `@/test/window-local-storage`
(allowlisted at [`.oxlintrc.json:74`](../.oxlintrc.json#L74)) because writing
the preference persists to storage. `contexts/os-notification-gate.rambla.test.tsx` — both notification paths
with the preference off and on, in the shape of
[`voice-capture-claim.rambla.test.tsx`](../packages/app/src/contexts/voice-capture-claim.rambla.test.tsx).
All three are jsdom renders; the project default is `node`
([`vitest.config.ts:17`](../packages/app/vitest.config.ts#L17)). Mount
requirements and fakes are named in the steps.

**Branch:** `feat/os-notification-toggle` — required, 4 upstream files edited.

## Constraints

- Only the 4 upstream files in the mitigation table and the 3 new
  `*.rambla.test.tsx` files change. No other file is touched.
- Upstream behavior is otherwise unchanged: the play-sound row keeps reading
  the desktop store; `os-notifications.ts`, `use-desktop-permissions.ts` and
  every dependency array in `session-context.tsx` stay as they are.
- No new abstractions, settings keys, i18n keys, or error handling beyond
  what the steps name. Upstream test files are not modified.

## Steps

0. Read the `code` skill first. If a step is wrong, amend this plan; do not
   re-decide placement while coding.
1. [`storage.ts`](../packages/app/src/hooks/use-settings/storage.ts): add `notificationsEnabled` at the 3
   sites `chatOutlineEnabled` uses ([`storage.ts:90`](../packages/app/src/hooks/use-settings/storage.ts#L90), [`storage.ts:143`](../packages/app/src/hooks/use-settings/storage.ts#L143) `true`, [`storage.ts:238`](../packages/app/src/hooks/use-settings/storage.ts#L238)
   `z.boolean().catch(true)`). `pickDefinedAppSettings` ([`index.ts:97-106`](../packages/app/src/hooks/use-settings/index.ts#L97-L106))
   iterates `Object.keys(DEFAULT_CLIENT_SETTINGS)`, so the new key routes
   through `updateSettings` and persists with no edit outside this file.
2. `contexts/os-notification-gate.rambla.test.tsx` failing first: mock
   `@/utils/os-notifications`; mount `SessionProvider` ([`session-context.tsx:204`](../packages/app/src/contexts/session-context.tsx#L204)) inside
   `QueryClientProvider` with a test-local `QueryClient` — the new `useSettings`
   call pulls two `useQuery` hooks ([`index.ts:135`](../packages/app/src/hooks/use-settings/index.ts#L135),
   [`desktop-settings.ts:51-61`](../packages/app/src/desktop/settings/desktop-settings.ts#L51-L61)) — and stub `DaemonClient` with
   `observeEvents` ([`session-context.tsx:520-532`](../packages/app/src/contexts/session-context.tsx#L520-L532)), one fake driving both attention
   paths, plus whatever `useClientActivity` ([`session-context.tsx:259`](../packages/app/src/contexts/session-context.tsx#L259)) and
   `startPushNotifications` ([`session-context.tsx:264`](../packages/app/src/contexts/session-context.tsx#L264)) call. Seed the client per
   case with the defaults, preference overridden, using `APP_SETTINGS_QUERY_KEY`
   ([`storage.ts:28`](../packages/app/src/hooks/use-settings/storage.ts#L28)) and `DEFAULT_CLIENT_SETTINGS` ([`storage.ts:143`](../packages/app/src/hooks/use-settings/storage.ts#L143)). Assert the
   mock fires with the preference on and not off. Then [`session-context.tsx`](../packages/app/src/contexts/session-context.tsx):
   `useSettings` import at the end of the import block; beside `appStateRef`
   ([`session-context.tsx:238`](../packages/app/src/contexts/session-context.tsx#L238)) a selector, a ref, and the per-render
   assignment; an early return on the ref before each `sendOsNotification`
   ([`session-context.tsx:312`](../packages/app/src/contexts/session-context.tsx#L312), [`session-context.tsx:713`](../packages/app/src/contexts/session-context.tsx#L713)). No dependency array
   changes: [`session-context.tsx:318`](../packages/app/src/contexts/session-context.tsx#L318) and [`session-context.tsx:744-761`](../packages/app/src/contexts/session-context.tsx#L744-L761) stay as they are.
3. `desktop-permission-row.rambla.test.tsx` failing first, then
   [`desktop-permission-row.tsx`](../packages/app/src/desktop/components/desktop-permission-row.tsx): `trailing?: ReactNode` prop ([`desktop-permission-row.tsx:10`](../packages/app/src/desktop/components/desktop-permission-row.tsx#L10)),
   destructure ([`desktop-permission-row.tsx:33`](../packages/app/src/desktop/components/desktop-permission-row.tsx#L33)), the new prop rendered after the actions view closing at
   [`desktop-permission-row.tsx:68`](../packages/app/src/desktop/components/desktop-permission-row.tsx#L68),
   and a type-only
   `ReactNode` import from `react` as a second `react` import at
   the end of the import block, leaving [`desktop-permission-row.tsx:1`](../packages/app/src/desktop/components/desktop-permission-row.tsx#L1)
   (`import { useMemo } from "react"`) alone. The row is
   `flexDirection: "row"` ([`settings.ts:35-41`](../packages/app/src/styles/settings.ts#L35-L41)), so `trailing` lands right of
   the pill ([`desktop-permission-row.tsx:56-59`](../packages/app/src/desktop/components/desktop-permission-row.tsx#L56-L59)).
4. `desktop-notifications-section.rambla.test.tsx` failing first. It renders
   upstream's component, so it must fake `@/desktop/host` with a
   `getDesktopHost()` that returns a bridge — otherwise
   `shouldShowDesktopPermissionSection()` is false
   ([`desktop-permissions.ts:125-127`](../packages/app/src/desktop/permissions/desktop-permissions.ts#L125-L127)) and the "card absent" assertion passes
   against nothing. `isWeb` needs no fake: unit tests alias `react-native` to
   `react-native-web`
   ([`vitest.config.ts:145-148`](../packages/app/vitest.config.ts#L145-L148)). Wrap the render in `QueryClientProvider`,
   which `useDesktopSettings` ([`desktop-settings.ts:51-61`](../packages/app/src/desktop/settings/desktop-settings.ts#L51-L61)) and `useSettings`
   through `useAppSettings` ([`index.ts:135`](../packages/app/src/hooks/use-settings/index.ts#L135)) both need.
   Then [`desktop-notifications-section.tsx`](../packages/app/src/desktop/components/desktop-notifications-section.tsx), in place: import `useSettings` at
   the end of the import block, then put one block after `permissionLabels`
   ([`desktop-notifications-section.tsx:73-80`](../packages/app/src/desktop/components/desktop-notifications-section.tsx#L73-L80)), above upstream's early return so every hook still runs: the aliased
   destructure of the no-argument overload ([`index.ts:177`](../packages/app/src/hooks/use-settings/index.ts#L177)),
   the app store as `appSettings`, its updater as `updateAppSettings`. The aliases are required:
   [`desktop-notifications-section.tsx:22`](../packages/app/src/desktop/components/desktop-notifications-section.tsx#L22) already binds `settings` and `updateSettings` to `useDesktopSettings()`,
   and upstream's `handlePlaySoundChange` ([`desktop-notifications-section.tsx:42-49`](../packages/app/src/desktop/components/desktop-notifications-section.tsx#L42-L49)) and the play-sound
   `Switch` ([`desktop-notifications-section.tsx:104`](../packages/app/src/desktop/components/desktop-notifications-section.tsx#L104)) keep reading the desktop ones. Then
   `handleOsNotificationsChange`, shaped like `handlePlaySoundChange` but
   calling `updateAppSettings` with the new boolean, and the
   `notificationsSwitch` memo — a `Switch`
   ([`switch.tsx:19-25`](../packages/app/src/components/ui/switch.tsx#L19-L25)) shaped like upstream's at [`desktop-notifications-section.tsx:103-109`](../packages/app/src/desktop/components/desktop-notifications-section.tsx#L103-L109) with its
   value bound to the app-store preference and `onValueChange` to the new
   handler, `accessibilityLabel` reusing `settings.notifications.title`
   ([`en.ts:2032`](../packages/app/src/i18n/resources/en.ts#L2032)). One block, not 3 placed beside upstream's
   matching groups: contiguous edits are 1 conflict region instead of 3.
   Both the handler and the memo are required:
   `react-perf/jsx-no-new-function-as-prop` and
   `react-perf/jsx-no-jsx-as-prop` are errors ([`.oxlintrc.json:49`](../.oxlintrc.json#L49),
   [`.oxlintrc.json:51`](../.oxlintrc.json#L51)).
   After upstream's early return at [`desktop-notifications-section.tsx:82-84`](../packages/app/src/desktop/components/desktop-notifications-section.tsx#L82-L84) add an early
   return of its own when the app-store preference is off: a `SettingsSection`
   with the notifications title and the switch in `trailing`, and nothing
   else. `children` is required ([`settings-section.tsx:22`](../packages/app/src/components/settings/headings/settings-section.tsx#L22)), so it is passed
   explicitly; `flush` is not used. The card and the test-result `Alert`s
   ([`desktop-notifications-section.tsx:132-147`](../packages/app/src/desktop/components/desktop-notifications-section.tsx#L132-L147)) are both below the early return, so both disappear.
   Then `trailing` at [`desktop-notifications-section.tsx:89`](../packages/app/src/desktop/components/desktop-notifications-section.tsx#L89)
   takes the switch, and the `DesktopPermissionRow` call at [`desktop-notifications-section.tsx:91-97`](../packages/app/src/desktop/components/desktop-notifications-section.tsx#L91-L97) takes
   the refresh button (the named `refreshButton`, [`desktop-notifications-section.tsx:58-72`](../packages/app/src/desktop/components/desktop-notifications-section.tsx#L58-L72)). Upstream's early return stays as the platform
   gate. No new i18n keys.

## Verification

- `npm run typecheck`, `npm run lint`, `npm run format` (from `rambla/`)
- `npx vitest run <file> --bail=1` for the 3 new tests and
  [`storage.test.ts`](../packages/app/src/hooks/use-settings/storage.test.ts)
- `git grep "RAMBLA-FORK:" -- <each of the 4 upstream files>` — all tagged.
- `just trial-merge`, then `just trial-merge drop`
- Desktop app, no restart: off — card gone, no banner for a finished agent; on
  — card back, refresh beside the pill, banner back. Restart: switch kept.
- Desktop app, switch on: the play-sound row sits where it did, toggles, and
  survives a restart — unchanged from before this work.

## Risks

- Our 4 sites in [`session-context.tsx`](../packages/app/src/contexts/session-context.tsx), the file upstream edits most often
  of the 4, are the widest exposure in this change.
- The 3 [`storage.ts`](../packages/app/src/hooks/use-settings/storage.ts) adds are 3 conflict sites, not 1 block — the
  shape every preference here has (`chatOutlineEnabled` [`storage.ts:90`](../packages/app/src/hooks/use-settings/storage.ts#L90), [`storage.ts:143`](../packages/app/src/hooks/use-settings/storage.ts#L143), [`storage.ts:238`](../packages/app/src/hooks/use-settings/storage.ts#L238)).
- The 5 sites in [`desktop-notifications-section.tsx`](../packages/app/src/desktop/components/desktop-notifications-section.tsx) sit at the import
  block, after [`desktop-notifications-section.tsx:80`](../packages/app/src/desktop/components/desktop-notifications-section.tsx#L80), after
  [`desktop-notifications-section.tsx:84`](../packages/app/src/desktop/components/desktop-notifications-section.tsx#L84), at
  [`desktop-notifications-section.tsx:89`](../packages/app/src/desktop/components/desktop-notifications-section.tsx#L89) and at
  [`desktop-notifications-section.tsx:91-97`](../packages/app/src/desktop/components/desktop-notifications-section.tsx#L91-L97), so an upstream
  rework of that section conflicts in several places at once.
- Until the settings query resolves, `useSettings` returns
  `DEFAULT_APP_SETTINGS` ([`index.ts:221-226`](../packages/app/src/hooks/use-settings/index.ts#L221-L226)), where the
  preference is its `true` default, so a notification arriving in that first
  window still fires for a user who switched them off.
