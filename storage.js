/* storage.js — Key_Manager + small state persistence over localStorage.
 * Keys are namespaced per provider. Nothing leaves the device from here. */

const KEY_PREFIX = "vgs.key.";       // + providerId
const STATE_KEY = "vgs.state";       // selected provider, etc.
const MAX_KEY_LEN = 4096;

const KeyManager = {
  available() {
    try {
      const t = "__vgs_test__";
      localStorage.setItem(t, "1");
      localStorage.removeItem(t);
      return true;
    } catch (e) {
      return false;
    }
  },

  /* Returns { ok: true } or { ok: false, error } */
  save(providerId, key) {
    if (key == null || key.trim() === "") {
      return { ok: false, error: "API key is empty." };
    }
    if (key.length > MAX_KEY_LEN) {
      return { ok: false, error: "API key is too long (max " + MAX_KEY_LEN + " characters)." };
    }
    if (!this.available()) {
      return { ok: false, error: "Could not save: browser storage is unavailable." };
    }
    try {
      localStorage.setItem(KEY_PREFIX + providerId, key);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: "Could not save the API key (storage full or blocked)." };
    }
  },

  get(providerId) {
    try {
      return localStorage.getItem(KEY_PREFIX + providerId) || "";
    } catch (e) {
      return "";
    }
  },

  has(providerId) {
    return this.get(providerId).trim() !== "";
  },

  remove(providerId) {
    try {
      localStorage.removeItem(KEY_PREFIX + providerId);
    } catch (e) { /* ignore */ }
  }
};

const StateStore = {
  read() {
    try {
      return JSON.parse(localStorage.getItem(STATE_KEY)) || {};
    } catch (e) {
      return {};
    }
  },
  patch(obj) {
    try {
      const next = Object.assign(this.read(), obj);
      localStorage.setItem(STATE_KEY, JSON.stringify(next));
    } catch (e) { /* ignore */ }
  }
};
