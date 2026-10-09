// RAMBLA-FORK: fix: 2026-09-30-fix-sidebar-shortcut-hover-wrap.md: speaks the row's shortcut, which is only on screen while hovered.
import { normalizeDisplayChord } from "@/components/ui/normalize-display-chord";
import { useKeyboardShortcutsAvailable } from "@/keyboard/availability";
import { formatShortcut, type ShortcutKey } from "@/utils/format-shortcut";
import { getShortcutOs } from "@/utils/shortcut-platform";

/** The label, followed by its formatted shortcut when one is set and shortcuts are available. */
export function useSidebarHeaderRowSpokenLabel(
  label: string,
  shortcutKeys: ShortcutKey[][] | null,
): string {
  const shortcutsAvailable = useKeyboardShortcutsAvailable();
  const displayChord = shortcutsAvailable ? normalizeDisplayChord(shortcutKeys ?? undefined) : null;
  return displayChord
    ? `${label}, ${displayChord.map((combo) => formatShortcut(combo, getShortcutOs())).join(" ")}`
    : label;
}
