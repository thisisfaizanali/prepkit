/** One-shot notices carried across a navigation (read once, then gone). */
const KEY = "prepkit:notice";

export function setNotice(text: string) {
  try {
    sessionStorage.setItem(KEY, text);
  } catch {
    // storage unavailable: the notice is lost, nothing else breaks
  }
}

export function takeNotice(): string | null {
  try {
    const text = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return text;
  } catch {
    return null;
  }
}
