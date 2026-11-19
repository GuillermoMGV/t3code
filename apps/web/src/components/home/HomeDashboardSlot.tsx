import { HomeDashboard } from "./HomeDashboard";

// Fork-only home dashboard; see CUSTOM_DEVELOPMENT.md.

/**
 * Hangs below the centred draft composer without moving it. The composer sits at mid-height, so
 * the dashboard gets the lower half of the screen and scrolls inside it; short windows skip it.
 */
export function HomeDashboardSlot() {
  return (
    <div className="absolute inset-x-0 top-full max-h-[calc(50dvh-6rem)] overflow-y-auto pt-6 pb-4 [@media(max-height:40rem)]:hidden">
      <HomeDashboard />
    </div>
  );
}
