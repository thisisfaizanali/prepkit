import type { SortingStrategy } from "@dnd-kit/sortable";

/**
 * Rows stay put while dragging; the target row shows an insertion line instead. Shifting rows of different heights
 * under the pointer makes the drop target flip back and forth every frame.
 */
export const noShift: SortingStrategy = () => null;

/** Where the dragged row will land relative to this one: below it when moving down the same list, else above. */
export const dropLine = (index: number, activeIndex: number) => (activeIndex >= 0 && activeIndex < index ? "drop-after" : "drop-target");
