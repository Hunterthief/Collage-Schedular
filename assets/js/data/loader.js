import { CONFIG } from "../config.js";

/**
 * The native `fetch` MUST be invoked with the global object as `this`.
 * In a module, calling a bare function reference (or storing `fetch` in a
 * property and calling it as a method) produces:
 *   TypeError: 'fetch' called on an object that does not implement interface Window
 *
 * We neutralize every form of that bug by always applying the function with
 * `globalThis` as the receiver via Reflect.apply. This is correct for the real
 * fetch and harmless for an injected test mock (mocks ignore `this`).
 */
export class DataLoader {
  constructor({ fetchImpl = null, baseUrl = "" } = {}) {
    // Never default to the bare `fetch` reference. null means "use global".
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

    // Supplying globalThis as the receiver makes illegal-invocation impossible,
    // even if `fn` is a detached reference to the native fetch.
    return Reflect.apply(fn, globalThis, [url, init]);
  }

  async loadJson(path, options = {}) {
    const url = this.resolve(path);
    const cacheKey = url;
    const noCache = options.cache === "no-store";

    if (!noCache && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const res = await this.request(url, {
      cache: options.cache ?? "default"
    });

    if (!res.ok) {
      throw new Error(`Failed to load ${path}: ${res.status} ${res.statusText}`);
    }

    const json = await res.json();

    if (!noCache) {
      this.cache.set(cacheKey, json);
    }

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

  async loadInstitutionData(manifest = this.manifest) {
    const [settings, locations, events] = await Promise.all([
      this.loadJson(manifest.paths.settings),
      this.loadJson(manifest.paths.locations),
      this.loadJson(manifest.paths.institutionEvents)
    ]);
    return { settings, locations, events };
  }

  async loadSemesterDatasets(semester, manifest = this.manifest) {
    const paths = semester.datasets;

    const [courses, lectures, practicals, exams, exceptions] =
      await Promise.all([
        this.loadJson(paths.courses),
        this.loadJson(paths.lectures),
        this.loadJson(paths.practicals),
        this.loadJson(paths.exams),
        this.loadJson(paths.exceptions)
      ]);

    return { courses, lectures, practicals, exams, exceptions };
  }
}
