import { dirname, normalize, type FSMap } from "./fs";

/**
 * The "project root" for an execution is the folder that contains the entry
 * file (or the folder itself if a folder is run). Everything inside that root —
 * including nested sub-folders — is available to the running program.
 * Nothing above the root is ever mounted.
 */
export function projectRootFor(fs: FSMap, target: string): string {
  const p = normalize(target);
  const node = fs[p];
  if (node && node.type === "folder") return p;
  return dirname(p);
}

/** All files under `root` (recursively), keyed by path relative to root. */
export function collectProject(fs: FSMap, root: string): Record<string, { content: string; binary?: boolean }> {
  const prefix = root ? root + "/" : "";
  const out: Record<string, { content: string; binary?: boolean }> = {};
  for (const path of Object.keys(fs)) {
    if (root && !path.startsWith(prefix)) continue;
    const node = fs[path];
    if (!node || node.type !== "file") continue;
    out[path.slice(prefix.length)] = { content: node.content, binary: node.binary };
  }
  return out;
}

/** Resolve a relative reference against `base`, refusing to escape `root`. */
export function resolveInRoot(root: string, base: string, ref: string): string | null {
  const stack = (base ? base.split("/") : []).filter(Boolean);
  for (const seg of ref.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (!stack.length) return null;
      stack.pop();
    } else stack.push(seg);
  }
  const resolved = stack.join("/");
  if (root && resolved !== root && !resolved.startsWith(root + "/")) return null;
  return resolved;
}

const MOUNT = "/sam_project";

/** Mount every file under `root` into the Pyodide FS at /sam_project and chdir there. */
export async function mountPythonProject(py: any, fs: FSMap, root: string) {
  const files = collectProject(fs, root);
  py.runPython(`
import shutil, os, sys
if os.path.isdir(${JSON.stringify(MOUNT)}):
    shutil.rmtree(${JSON.stringify(MOUNT)})
os.makedirs(${JSON.stringify(MOUNT)}, exist_ok=True)
`);
  for (const [rel, file] of Object.entries(files)) {
    const full = `${MOUNT}/${rel}`;
    const dir = full.slice(0, full.lastIndexOf("/"));
    try {
      py.FS.mkdirTree(dir);
      if (file.binary) {
        const bin = atob(file.content);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        py.FS.writeFile(full, arr);
      } else {
        py.FS.writeFile(full, file.content, { encoding: "utf8" });
      }
    } catch {
      /* ignore individual file errors */
    }
  }
  py.runPython(`
import os, sys
os.chdir(${JSON.stringify(MOUNT)})
for p in [${JSON.stringify(MOUNT)}]:
    if p in sys.path: sys.path.remove(p)
sys.path.insert(0, ${JSON.stringify(MOUNT)})
`);
  return MOUNT;
}

/** Copy files written by the program back is not supported; read one file out. */
export function pythonMountPath() {
  return MOUNT;
}

/** Parse a .bat / .cmd / .sh script into executable command lines. */
export function parseScriptCommands(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^@/, ""))
    .filter((l) => {
      const lower = l.toLowerCase();
      if (lower.startsWith("rem ") || lower === "rem") return false;
      if (lower.startsWith("::")) return false;
      if (lower.startsWith("#")) return false;
      if (lower === "echo off" || lower === "echo on") return false;
      if (lower === "cls" || lower === "clear") return false;
      if (lower.startsWith("setlocal") || lower.startsWith("endlocal")) return false;
      if (lower === "exit" || lower.startsWith("exit ")) return false;
      return true;
    });
}
