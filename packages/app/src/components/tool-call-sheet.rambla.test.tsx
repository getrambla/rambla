/**
 * @vitest-environment jsdom
 *
 * Fork test (rambla): the tool-call sheet must surface the file path for
 * Edit/Write calls and open the viewer when the path is tapped. The sheet body
 * normally lives behind `IsolatedBottomSheetModal`, which the global
 * `@gorhom/bottom-sheet` stub renders as null — mock the isolation wrapper to
 * a passthrough so `ToolCallSheetContent` actually mounts.
 */
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/isolated-bottom-sheet-modal", () => {
  const state = { visible: true as boolean };
  return {
    IsolatedBottomSheetModal: ({ children }: { children?: React.ReactNode }) => (
      <div data-bottom-sheet>{children}</div>
    ),
    useIsolatedBottomSheetVisibility: ({ visible }: { visible: boolean }) => {
      state.visible = visible;
      return {
        sheetRef: () => undefined,
        handleSheetChange: () => undefined,
        handleSheetDismiss: () => undefined,
      };
    },
    __sheetVisibilityState: state,
  };
});

vi.mock("./tool-call-details", () => ({
  ToolCallDetailsContent: () => <div data-tool-call-details />,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "common.actions.close": "Close",
        "message.actions.openFile": "Open file",
      })[key] ?? key,
  }),
}));

import { ToolCallSheetProvider, useToolCallSheet } from "./tool-call-sheet";
import type { ToolCallSheetData } from "./tool-call-sheet";
import * as isolatedBottomSheetModal from "@/components/ui/isolated-bottom-sheet-modal";

const sheetVisibilityState = (
  isolatedBottomSheetModal as unknown as {
    __sheetVisibilityState?: { visible: boolean };
  }
).__sheetVisibilityState;

const TestIcon = () => null;

function SheetOpener({ data }: { data: ToolCallSheetData }) {
  const { openToolCall } = useToolCallSheet();
  React.useEffect(() => {
    openToolCall(data);
  }, [openToolCall, data]);
  return null;
}

describe("ToolCallSheet file path link", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function renderSheet(data: ToolCallSheetData) {
    act(() => {
      root.render(
        <ToolCallSheetProvider>
          <SheetOpener data={data} />
        </ToolCallSheetProvider>,
      );
    });
  }

  function queryByTestId(testID: string): HTMLElement | null {
    return document.querySelector(`[data-testid="${testID}"]`);
  }

  function click(element: Element) {
    act(() => {
      element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
  }

  const baseData: ToolCallSheetData = {
    toolName: "Edit",
    displayName: "Edit",
    icon: TestIcon,
  };

  it("renders the file path and opens the viewer when tapped", () => {
    const onOpenFile = vi.fn();
    renderSheet({ ...baseData, filePath: "src/app/main.tsx", onOpenFile });

    const pathLink = queryByTestId("tool-call-sheet-file-path");
    expect(pathLink).not.toBeNull();
    expect(pathLink?.textContent).toBe("src/app/main.tsx");
    expect(pathLink?.getAttribute("aria-label")).toBe("Open file");

    click(pathLink!);
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    // The sheet is portal-hosted above the navigator; tapping the path must close it
    // so the opened file is not occluded.
    expect(sheetVisibilityState?.visible).toBe(false);
  });

  it("renders the path without a press handler when onOpenFile is absent", () => {
    renderSheet({ ...baseData, filePath: "src/app/main.tsx" });

    const pathRow = queryByTestId("tool-call-sheet-file-path");
    expect(pathRow).not.toBeNull();
    expect(pathRow?.textContent).toBe("src/app/main.tsx");
    expect(pathRow?.getAttribute("aria-label")).toBeNull();
  });

  it("omits the path row when no file path is provided", () => {
    renderSheet(baseData);

    expect(queryByTestId("tool-call-sheet-file-path")).toBeNull();
  });
});
