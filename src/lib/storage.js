/**
 * localStorage that never throws. It is unavailable in private windows and
 * with site data blocked, and a remembered panel choice is not worth a crash.
 */
export function load(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not worth surfacing: the app works fine without a remembered choice.
  }
}
