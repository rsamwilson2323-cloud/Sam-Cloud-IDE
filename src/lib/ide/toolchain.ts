import { ensureFolders, type FSMap } from "./fs";

/** Root folder that holds every language's runtime + package library. */
export const LIBRARY = "LIBRARY";

export type RuntimeId =
  | "python"
  | "node"
  | "typescript"
  | "html"
  | "css"
  | "javascript"
  | "c"
  | "cpp"
  | "java"
  | "php"
  | "bash"
  | "json"
  | "xml"
  | "react"
  | "vue"
  | "angular"
  | "tailwind"
  | "bootstrap"
  | "text"
  | "yaml"
  | "ini"
  | "csv";

export type Runtime = {
  id: RuntimeId;
  name: string;
  group: "Programming" | "Web" | "Others";
  /** default (latest) version shipped with the IDE */
  version: string;
  /** where extra versions/packages can be searched from */
  registry?: "pypi" | "npm" | "none";
  /** how the IDE executes this language */
  exec: "pyodide" | "browser" | "sandbox" | "preview" | "static";
  bin?: string[];
};

export const RUNTIMES: Runtime[] = [
  { id: "python", name: "Python", group: "Programming", version: "3.12.1", registry: "pypi", exec: "pyodide", bin: ["python", "python3", "py", "pip", "pip3"] },
  { id: "javascript", name: "JavaScript (ES2024)", group: "Programming", version: "ES2024", registry: "npm", exec: "sandbox", bin: ["node"] },
  { id: "node", name: "Node.js", group: "Programming", version: "22.11.0", registry: "npm", exec: "sandbox", bin: ["node", "npm", "npx", "bun", "yarn", "pnpm"] },
  { id: "typescript", name: "TypeScript", group: "Programming", version: "5.6.3", registry: "npm", exec: "sandbox", bin: ["tsc", "ts-node"] },
  { id: "html", name: "HTML5", group: "Programming", version: "5", exec: "preview" },
  { id: "css", name: "CSS3", group: "Programming", version: "3", exec: "preview" },
  { id: "c", name: "C (clang wasm)", group: "Programming", version: "C17", exec: "static", bin: ["gcc", "cc", "clang"] },
  { id: "cpp", name: "C++ (clang wasm)", group: "Programming", version: "C++20", exec: "static", bin: ["g++", "clang++"] },
  { id: "java", name: "Java", group: "Programming", version: "21", exec: "static", bin: ["java", "javac"] },
  { id: "php", name: "PHP", group: "Programming", version: "8.3", exec: "static", bin: ["php"] },
  { id: "bash", name: "Bash / Shell", group: "Programming", version: "5.2", exec: "browser", bin: ["bash", "sh"] },
  { id: "json", name: "JSON", group: "Programming", version: "RFC 8259", exec: "static" },
  { id: "xml", name: "XML", group: "Programming", version: "1.0", exec: "static" },
  { id: "react", name: "React", group: "Web", version: "19.0.0", registry: "npm", exec: "preview" },
  { id: "vue", name: "Vue", group: "Web", version: "3.5.13", registry: "npm", exec: "preview" },
  { id: "angular", name: "Angular", group: "Web", version: "19.0.0", registry: "npm", exec: "preview" },
  { id: "tailwind", name: "Tailwind CSS", group: "Web", version: "4.0.0", registry: "npm", exec: "preview" },
  { id: "bootstrap", name: "Bootstrap", group: "Web", version: "5.3.3", registry: "npm", exec: "preview" },
  { id: "text", name: "Plain Text", group: "Others", version: "—", exec: "static" },
  { id: "yaml", name: "YAML", group: "Others", version: "1.2", exec: "static" },
  { id: "ini", name: "INI", group: "Others", version: "—", exec: "static" },
  { id: "csv", name: "CSV", group: "Others", version: "RFC 4180", exec: "static" },
];

export function runtimeFor(bin: string): Runtime | undefined {
  return RUNTIMES.find((r) => r.bin?.includes(bin));
}

/* ============ installed state (localStorage) ============ */

export type Installed = {
  /** runtimeId -> selected version */
  runtimes: Record<string, string>;
  /** runtimeId -> { pkgName: version } */
  packages: Record<string, Record<string, string>>;
};

const KEY = "sam-ide-toolchain-v1";

export function loadInstalled(): Installed {
  const base: Installed = { runtimes: {}, packages: {} };
  for (const r of RUNTIMES) base.runtimes[r.id] = r.version;
  if (typeof window === "undefined") return base;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Installed;
    return {
      runtimes: { ...base.runtimes, ...(parsed.runtimes || {}) },
      packages: parsed.packages || {},
    };
  } catch {
    return base;
  }
}

export function saveInstalled(state: Installed) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/* ============ LIBRARY folder mirroring ============ */

function libDoc(r: Runtime, version: string, pkgs: Record<string, string>) {
  const list = Object.entries(pkgs).sort(([a], [b]) => a.localeCompare(b));
  return [
    `# ${r.name}`,
    ``,
    `Active version: ${version}`,
    `Registry: ${r.registry ?? "none"}`,
    ``,
    `## Installed packages (${list.length})`,
    ...(list.length ? list.map(([n, v]) => `- ${n}@${v}`) : ["- (none yet — use the terminal or the Extensions panel)"]),
    ``,
  ].join("\n");
}

/**
 * Make sure LIBRARY/<language>/ exists for every supported language and mirror
 * the installed packages into readable files. Pure: returns a new FSMap.
 */
export function syncLibrary(fs: FSMap, state: Installed): FSMap {
  const next = { ...fs };
  next[LIBRARY] = { type: "folder" };
  for (const r of RUNTIMES) {
    const folder = `${LIBRARY}/${r.id}`;
    next[folder] = { type: "folder" };
    const version = state.runtimes[r.id] || r.version;
    const pkgs = state.packages[r.id] || {};
    const readme = `${folder}/README.md`;
    next[readme] = { type: "file", content: libDoc(r, version, pkgs) };
    const pkgsFolder = `${folder}/packages`;
    // drop stale package entries
    for (const key of Object.keys(next)) {
      if (key.startsWith(pkgsFolder + "/")) delete next[key];
    }
    if (Object.keys(pkgs).length) {
      next[pkgsFolder] = { type: "folder" };
      for (const [name, v] of Object.entries(pkgs)) {
        const safe = name.replace(/\//g, "__");
        const p = `${pkgsFolder}/${safe}.pkg`;
        ensureFolders(next, p);
        next[p] = { type: "file", content: `name: ${name}\nversion: ${v}\nlanguage: ${r.id}\n` };
      }
    } else {
      delete next[pkgsFolder];
    }
  }
  return next;
}

/* ============ registry lookups (web) ============ */

export type SearchHit = {
  name: string;
  version: string;
  description?: string;
  registry: "pypi" | "npm";
};

export async function searchNpm(q: string): Promise<SearchHit[]> {
  const res = await fetch(`https://registry.npmjs.org/-/v1/search?size=15&text=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`npm search failed (${res.status})`);
  const json: any = await res.json();
  return (json.objects || []).map((o: any) => ({
    name: o.package.name,
    version: o.package.version,
    description: o.package.description,
    registry: "npm" as const,
  }));
}

export async function searchPypi(q: string): Promise<SearchHit[]> {
  // PyPI has no CORS search API; resolve the exact package (and a few guesses).
  const names = Array.from(new Set([q, q.toLowerCase(), q.replace(/\s+/g, "-")]));
  const hits: SearchHit[] = [];
  for (const n of names) {
    try {
      const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(n)}/json`);
      if (!res.ok) continue;
      const json: any = await res.json();
      hits.push({
        name: json.info.name,
        version: json.info.version,
        description: json.info.summary,
        registry: "pypi",
      });
    } catch {
      /* ignore */
    }
  }
  return hits;
}

/** Available versions of a package from its registry (newest first). */
export async function fetchVersions(registry: "pypi" | "npm", name: string): Promise<string[]> {
  if (registry === "npm") {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`not found on npm: ${name}`);
    const json: any = await res.json();
    return Object.keys(json.versions || {}).reverse();
  }
  const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
  if (!res.ok) throw new Error(`not found on PyPI: ${name}`);
  const json: any = await res.json();
  return Object.keys(json.releases || {}).reverse();
}

/** Runtime versions available for a language (used by the Extensions panel). */
export async function fetchRuntimeVersions(id: RuntimeId): Promise<string[]> {
  if (id === "node") {
    const res = await fetch("https://nodejs.org/dist/index.json");
    if (!res.ok) throw new Error("could not reach nodejs.org");
    const json: any = await res.json();
    return json.slice(0, 60).map((v: any) => String(v.version).replace(/^v/, ""));
  }
  if (id === "python") {
    const res = await fetch("https://endoflife.date/api/python.json");
    if (res.ok) {
      const json: any = await res.json();
      return json.map((v: any) => v.latest as string);
    }
    return ["3.13.0", "3.12.1", "3.11.9", "3.10.14", "3.9.19"];
  }
  const rt = RUNTIMES.find((r) => r.id === id);
  if (rt?.registry === "npm") {
    const pkg = id === "react" ? "react" : id === "vue" ? "vue" : id === "angular" ? "@angular/core" : id === "tailwind" ? "tailwindcss" : id === "typescript" ? "typescript" : id;
    return (await fetchVersions("npm", pkg)).slice(0, 60);
  }
  return rt ? [rt.version] : [];
}
