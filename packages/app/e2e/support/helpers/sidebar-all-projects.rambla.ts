import type { Page } from "@playwright/test";

// RAMBLA-FORK: fix: (no plan): e2e sidebar lists every project, as upstream's tests expect.

export async function showAllProjectsInSidebar(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const sidebarViewKey = "sidebar-view";
    if (localStorage.getItem(sidebarViewKey) === null) {
      localStorage.setItem(
        sidebarViewKey,
        JSON.stringify({ state: { activeProjectsOnly: false } }),
      );
    }
  });
}
