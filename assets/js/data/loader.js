import { CONFIG } from "../config.js";

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
    if (this.fetchImpl) {
      return this.fetchImpl(url, init);
    }

    if (typeof globalThis.fetch !== "function") {
      throw new Error("Fetch is not available in this environment.");
    }

    return globalThis.fetch(url, init);
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

    const [courses, lectures, practicals, exams, exceptions] = await Promise.all([
      this.loadJson(paths.courses),
      this.loadJson(paths.lectures),
      this.loadJson(paths.practicals),
      this.loadJson(paths.exams),
      this.loadJson(paths.exceptions)
    ]);

    return { courses, lectures, practicals, exams, exceptions };
  }
}
