import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 639px)";
const subscribe = (cb: () => void) => {
  const m = matchMedia(QUERY);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

/** Phone width: row actions collapse into "More". */
export const useNarrow = () => useSyncExternalStore(subscribe, () => matchMedia(QUERY).matches, () => false);
