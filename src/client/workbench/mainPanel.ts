import type { SidebarTab } from "../persistence.ts";

/** Key used by Desktop's root-scoped keyed main slot. */
export const MAIN_PANEL_ID = "dsh-azu-creator";

/** Minimal layout face shared by Desktop 2.x and older Web hosts. */
export interface MainPanelLayout {
  selectPanel?: (panelId: string | null) => void;
}

/** Map the product sidebar selection to the host's central panel selection. */
export function selectCreatorPanel(layout: MainPanelLayout, tab: SidebarTab): void {
  layout.selectPanel?.(tab === "sessions" ? null : MAIN_PANEL_ID);
}
