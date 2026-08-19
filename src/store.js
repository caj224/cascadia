// Same async shape the artifact used, backed by localStorage.
// Swap the two bodies for IndexedDB or a server call if you ever sync.
export const store = {
  async get(key) {
    const v = localStorage.getItem(key);
    if (v === null) throw new Error("not found: " + key);
    return { key, value: v };
  },
  async set(key, value) {
    localStorage.setItem(key, value);
    return { key, value };
  },
};
