// Fork-only: a click on empty sidebar space goes home; see CUSTOM_DEVELOPMENT.md.
import { useNavigate } from "@tanstack/react-router";
import { type MouseEvent, type PointerEvent, useRef } from "react";

const INTERACTIVE_SELECTOR = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "label",
  "summary",
  "[contenteditable='true']",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='option']",
  "[role='checkbox']",
  "[role='switch']",
  "[role='tab']",
  "[role='combobox']",
  "[role='textbox']",
  "[role='separator']",
  "[data-thread-item]",
  "[data-slot='sidebar-rail']",
].join(",");

export function useSidebarBlankClick() {
  const navigate = useNavigate();
  const pressedTargetRef = useRef<EventTarget | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    pressedTargetRef.current = event.target;
  };

  const onClick = (event: MouseEvent<HTMLElement>) => {
    const pressedTarget = pressedTargetRef.current;
    pressedTargetRef.current = null;
    const target = event.target;
    // A drag ending on empty space clicks the common ancestor; only a press and release on the
    // same blank spot counts. Portaled menus bubble here in React but sit outside the DOM node.
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      target !== pressedTarget ||
      !(target instanceof Element) ||
      !event.currentTarget.contains(target) ||
      target.closest(INTERACTIVE_SELECTOR) !== null ||
      window.getSelection()?.isCollapsed === false
    ) {
      return;
    }
    void navigate({ to: "/" });
  };

  return { onPointerDown, onClick };
}
