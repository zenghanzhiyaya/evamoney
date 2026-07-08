// Polyfill for Claude's artifact `window.storage` API, backed by real localStorage,
// so the same component code works on a normal deployed site.
if (!window.storage) {
  const k = (key, shared) => (shared ? `shared:${key}` : `local:${key}`);

  window.storage = {
    async get(key, shared = false) {
      const raw = localStorage.getItem(k(key, shared));
      if (raw === null) throw new Error("Key not found: " + key);
      return { key, value: raw, shared };
    },
    async set(key, value, shared = false) {
      localStorage.setItem(k(key, shared), value);
      return { key, value, shared };
    },
    async delete(key, shared = false) {
      localStorage.removeItem(k(key, shared));
      return { key, deleted: true, shared };
    },
    async list(prefix = "", shared = false) {
      const marker = shared ? "shared:" : "local:";
      const keys = Object.keys(localStorage)
        .filter(fullKey => fullKey.startsWith(marker + prefix))
        .map(fullKey => fullKey.slice(marker.length));
      return { keys, prefix, shared };
    },
  };
}
