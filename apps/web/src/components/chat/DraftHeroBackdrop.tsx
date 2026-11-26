// Fork-only artwork behind the new-thread hero; see CUSTOM_DEVELOPMENT.md.
import darkArtUrl from "../../assets/draft-hero/draft-hero-dark.webp";
import lightArtUrl from "../../assets/draft-hero/draft-hero-light.webp";

// Blend modes keep the art on whatever background the active theme paints.
export function DraftHeroBackdrop() {
  return (
    <div
      aria-hidden
      data-draft-hero-backdrop
      className="pointer-events-none absolute inset-0 z-0 select-none overflow-hidden mask-t-from-85%"
    >
      <img
        alt=""
        src={lightArtUrl}
        decoding="async"
        draggable={false}
        className="size-full object-cover mix-blend-multiply dark:hidden"
      />
      <img
        alt=""
        src={darkArtUrl}
        decoding="async"
        draggable={false}
        className="hidden size-full object-cover mix-blend-screen dark:block"
      />
    </div>
  );
}
