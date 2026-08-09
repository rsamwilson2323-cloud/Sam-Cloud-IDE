// Simple in-memory + localStorage file system for the IDE.
// Paths use forward slashes, no leading slash. Folders are tracked by entries with type 'folder'.

export type FSNode =
  | { type: "folder" }
  | { type: "file"; content: string; binary?: boolean; mime?: string };

export type FSMap = Record<string, FSNode>;

const KEY = "sam-ide-fs-v1";

export function loadFS(): FSMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw) as FSMap;
  } catch {
    return {};
  }
}

export function saveFS(fs: FSMap) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(fs));
  } catch {
    // Quota exceeded (big uploads). Persist a lighter snapshot: keep every text
    // file + folder, drop large binaries — they stay available in memory for
    // this session so uploads of any size still work.
    try {
      const light: FSMap = {};
      for (const [k, v] of Object.entries(fs)) {
        if (v.type === "folder") light[k] = v;
        else if (!v.binary && v.content.length < 512_000) light[k] = v;
        else light[k] = { type: "file", content: "", binary: v.binary, mime: (v as any).mime };
      }
      localStorage.setItem(KEY, JSON.stringify(light));
    } catch (e) {
      console.warn("FS save failed", e);
    }
  }
}


export function normalize(p: string) {
  return p.replace(/^\/+/, "").replace(/\/+/g, "/").replace(/\/$/, "");
}

export function dirname(p: string) {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

export function basename(p: string) {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

export function extname(p: string) {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i < 0 ? "" : b.slice(i + 1).toLowerCase();
}

export function ensureFolders(fs: FSMap, path: string) {
  const parts = normalize(path).split("/").filter(Boolean);
  let cur = "";
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur ? `${cur}/${parts[i]}` : parts[i];
    if (!fs[cur]) fs[cur] = { type: "folder" };
  }
}

export function listChildren(fs: FSMap, folder: string) {
  const prefix = folder ? folder + "/" : "";
  const out: { path: string; name: string; node: FSNode }[] = [];
  for (const path of Object.keys(fs)) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    if (!rest || rest.includes("/")) continue;
    out.push({ path, name: rest, node: fs[path] });
  }
  out.sort((a, b) => {
    if (a.node.type !== b.node.type) return a.node.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

export function deletePath(fs: FSMap, path: string) {
  const p = normalize(path);
  delete fs[p];
  const prefix = p + "/";
  for (const k of Object.keys(fs)) if (k.startsWith(prefix)) delete fs[k];
}

export function renamePath(fs: FSMap, oldPath: string, newPath: string) {
  const oldP = normalize(oldPath);
  const newP = normalize(newPath);
  if (!fs[oldP] || fs[newP]) return false;
  ensureFolders(fs, newP);
  fs[newP] = fs[oldP];
  delete fs[oldP];
  const prefix = oldP + "/";
  for (const k of Object.keys(fs)) {
    if (k.startsWith(prefix)) {
      const moved = newP + "/" + k.slice(prefix.length);
      fs[moved] = fs[k];
      delete fs[k];
    }
  }
  return true;
}
