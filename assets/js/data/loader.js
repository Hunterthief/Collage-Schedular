import { CONFIG } from "../config.js";

// Native fetch must be called with the global object as `this`.
// We always apply it via Reflect.apply so a detached reference can never
// trigger: 'fetch' called on an object that does not implement interface Window.
export class DataLoader {
  constructor({ fetchImpl = null, baseUrl = "" } = {}) {
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl;
    this.cache = new Map();
    this.manifest = null;
  }

  resolve(path) {
    if (!this.baseUrl) return path;
    return new URL(path, this.baseUrl).href;
  }

  async request(url, init) {
    const fn = this.fetchImpl ?? globalThis.fetch;
    if (typeof fn !== "function") {
      throw new Error("Fetch is not available in this environment.");
    }
    return Reflect.apply(fn, globalThis, [url, init]);
  }

  async loadJson(path, options = {}) {
    const url = this.resolve(path);
    const cacheKey = url;
    const noCache = options.cache === "no-store";

    if (!noCache && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const res = await this.request(url, { cache: options.cache ?? "default" });

    if (!res.ok) {
      const error = new Error(`Failed to load ${path}: ${res.status} ${res.statusText}`);
      error.status = res.status;
      error.path = path;
      throw error;
    }

    const json = await res.json();
    if (!noCache) this.cache.set(cacheKey, json);
    return json;
  }

  async loadManifest() {
    this.manifest = await this.loadJson(CONFIG.manifestPath, {
      cache: CONFIG.request.manifest.cache
    });
    return this.manifest;
  }

  async loadPrograms(manifest = this.manifest) {
    return this.loadJson(manifest.paths.programs);
  }

  async loadSettings(manifest = this.manifest) {
    return this.loadJson(manifest.paths.settings);
  }

  async loadLocations(manifest = this.manifest) {
    return this.loadJson(manifest.paths.locations);
  }

  async loadInstitutionEvents(manifest = this.manifest) {
    return this.loadJson(manifest.paths.institutionEvents);
  }

  async loadInstitutionData(manifest = this.manifest) {
    const [settings, locations, events] = await Promise.all([
      this.loadSettings(manifest),
      this.loadLocations(manifest),
      this.loadInstitutionEvents(manifest)
    ]);
    return { settings, locations, events };
  }

  async loadSemesterDatasets(semester, manifest = this.manifest) {
    const keys = ["courses", "lectures", "practicals", "exams", "exceptions"];

    const results = await Promise.all(
      keys.map(async (key) => {
        const path = semester?.datasets?.[key];
        if (!path) {
          const error = new Error(
            `Missing dataset path for ${key} in semester ${semester?.id ?? "unknown"}.`
          );
          error.status = null;
          error.path = null;
          return { key, path: null, value: null, error };
        }
        try {
          const value = await this.loadJson(path);
          return { key, path, value, error: null };
        } catch (error) {
          return { key, path, value: null, error };
        }
      })
    );

    const missing = results.filter((item) => item.error && item.error.status === 404);
    if (missing.length > 0) {
      const details = missing.map((item) => `${item.key}: ${item.path}`).join("; ");
      throw new Error(
        `Missing dataset file(s): ${details}. Check that these files exist in the repository and are published to GitHub Pages.`
      );
    }

    const failed = results.find((item) => item.error);
    if (failed) throw failed.error;

    return Object.fromEntries(results.map((item) => [item.key, item.value]));
  }
}
