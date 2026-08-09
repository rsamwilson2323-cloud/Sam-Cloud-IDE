import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import { toast } from "sonner";
import {
  basename,
  deletePath,
  dirname,
  ensureFolders,
  extname,
  listChildren,
  loadFS,
  normalize,
  renamePath,
  saveFS,
  type FSMap,
  type FSNode,
} from "@/lib/ide/fs";
import { DEFAULT_FS } from "@/lib/ide/defaults";
import { buildPreviewHtml } from "@/lib/ide/preview";
import { projectRootFor, mountPythonProject, parseScriptCommands } from "@/lib/ide/project";
import { runNodeFile, clientBridgeScript, stopAllServers, type VirtualServer } from "@/lib/ide/node-runtime";
import {
  LIBRARY,
  RUNTIMES,
  fetchRuntimeVersions,
  fetchVersions,
  loadInstalled,
  runtimeFor,
  saveInstalled,
  searchNpm,
  searchPypi,
  syncLibrary,
  type Installed,
  type Runtime,
  type SearchHit,
} from "@/lib/ide/toolchain";
import { chatWithGroq } from "@/lib/ai-groq.functions";

import AiMessage from "./AiMessage";
import { useServerFn } from "@tanstack/react-start";

// Pip → Pyodide package alias map (import name → PyPI package name)
const PIP_ALIAS: Record<string, string> = {
  cv2: "opencv-python",
  sklearn: "scikit-learn",
  bs4: "beautifulsoup4",
  PIL: "Pillow",
  yaml: "pyyaml",
  serial: "pyserial",
  Crypto: "pycryptodome",
};

declare global {
  interface Window {
    require: any;
    monaco: any;
    Terminal: any;
    FitAddon: any;
    loadPyodide: any;
  }
}

const LANG_MAP: Record<string, string> = {
  js: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript", jsx: "javascript",
  py: "python", html: "html", htm: "html", css: "css", scss: "scss",
  json: "json", md: "markdown", xml: "xml", yml: "yaml", yaml: "yaml",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp",
  java: "java", php: "php", sh: "shell", bash: "shell",
  sql: "sql", ini: "ini", csv: "plaintext", txt: "plaintext",
  jsonc: "json", json5: "json", less: "less", sass: "scss",
  vue: "html", svelte: "html", astro: "html", ejs: "html", hbs: "html",
  toml: "ini", cfg: "ini", conf: "ini", env: "ini", properties: "ini",
  bat: "bat", cmd: "bat", ps1: "powershell", zsh: "shell", fish: "shell",
  go: "go", rs: "rust", rb: "ruby", kt: "kotlin", swift: "swift",
  cs: "csharp", dart: "dart", lua: "lua", r: "r", pl: "perl",
  m: "objective-c", scala: "scala", graphql: "graphql", gql: "graphql",
  dockerfile: "dockerfile", makefile: "makefile", tf: "hcl",
  svg: "xml", xhtml: "html", plist: "xml", log: "plaintext", markdown: "markdown",
};


const IMG_EXT = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"]);
const VID_EXT = new Set(["mp4", "webm", "mov", "mkv", "avi"]);
const AUD_EXT = new Set(["mp3", "wav", "ogg"]);
const PDF_EXT = new Set(["pdf"]);

type SidebarTab = "explorer" | "search" | "git" | "extensions" | "ai" | "debug" | "settings";
type BottomTab = "terminal" | "output" | "problems" | "preview" | "console";

type Problem = { file: string; line: number; col: number; message: string; severity: "error" | "warning" };
type LogLine = { level: "log" | "warn" | "error" | "info"; text: string };

/** Extensions that must be preserved verbatim as text (never base64-ified on upload). */
const TEXT_EXTS = new Set([
  "txt","md","mdx","rst","log","json","jsonc","json5","map","js","mjs","cjs","ts","tsx","jsx","vue","svelte",
  "html","htm","xhtml","css","scss","sass","less","styl","py","pyw","ipynb","c","h","cpp","cc","cxx","hpp",
  "cs","java","kt","kts","go","rs","rb","php","pl","pm","lua","r","dart","swift","m","mm","sql","sh","bash",
  "zsh","fish","bat","cmd","ps1","psm1","xml","svg","yml","yaml","toml","ini","cfg","conf","properties","env",
  "gitignore","gitattributes","npmrc","nvmrc","editorconfig","dockerfile","makefile","gradle","lock","csv","tsv",
  "graphql","gql","proto","tf","asm","s","f90","vb","pas","hbs","ejs","pug","twig","liquid","srt","vtt","diff","patch",
]);
const TEXT_FILENAMES = new Set(["dockerfile","makefile","license","readme","changelog","procfile",".gitignore",".env"]);

function isTextLikeFile(name: string, ext: string, mime: string) {
  const lower = name.toLowerCase();
  if (TEXT_FILENAMES.has(lower)) return true;
  if (TEXT_EXTS.has(ext)) return true;
  if (!name.includes(".")) return true;
  if (mime && (mime.startsWith("text/") || /(json|xml|javascript|typescript|x-sh|yaml)/i.test(mime))) return true;
  return false;
}


function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.dataset.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load " + src));
    document.head.appendChild(s);
  });
}

let monacoReadyPromise: Promise<void> | null = null;
function ensureMonaco() {
  if (monacoReadyPromise) return monacoReadyPromise;
  monacoReadyPromise = (async () => {
    await loadScript("https://cdn.jsdelivr.net/npm/monaco-editor@0.50.0/min/vs/loader.js");
    await new Promise<void>((resolve) => {
      window.require.config({
        paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.50.0/min/vs" },
      });
      window.require(["vs/editor/editor.main"], () => resolve());
    });
    // Define a glass-friendly theme
    window.monaco.editor.defineTheme("sam-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "7a8aa8", fontStyle: "italic" },
        { token: "keyword", foreground: "82aaff" },
        { token: "string", foreground: "c3e88d" },
        { token: "number", foreground: "f78c6c" },
      ],
      colors: {
        "editor.background": "#0e1426",
        "editor.foreground": "#e7ecff",
        "editorLineNumber.foreground": "#3d4868",
        "editorLineNumber.activeForeground": "#7aa2ff",
        "editor.selectionBackground": "#264f7855",
        "editorCursor.foreground": "#7aa2ff",
        "editorIndentGuide.background": "#1c2540",
      },
    });
  })();
  return monacoReadyPromise;
}

let pyodidePromise: Promise<any> | null = null;
function ensurePyodide(onStdout: (s: string) => void, onStderr: (s: string) => void) {
  if (pyodidePromise) return pyodidePromise;
  pyodidePromise = (async () => {
    await loadScript("https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js");
    const py = await window.loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/",
      stdout: onStdout,
      stderr: onStderr,
    });
    await py.loadPackage("micropip");
    return py;
  })();
  // If init itself fails, allow retry
  pyodidePromise.catch(() => { pyodidePromise = null; });
  return pyodidePromise;
}
function resetPyodide() { pyodidePromise = null; }
function isFatalPyError(e: any) {
  const s = String(e?.message || e || "");
  return /fatally failed|no longer be used|PythonError.*fatal|SystemError/i.test(s);
}

const CV2_SHIM = `
import sys, types, time
_cv2 = types.ModuleType("cv2")
class _VideoCapture:
    def __init__(self, *a, **kw): self._open = True; self._n = 0
    def isOpened(self): return self._open
    def read(self):
        self._n += 1
        try:
            import numpy as _np
            return True, _np.zeros((1,1,3), dtype='uint8')
        except Exception:
            return True, None
    def release(self): self._open = False
    def set(self, *a, **kw): return True
    def get(self, *a, **kw): return 0
_cv2.VideoCapture = _VideoCapture
_cv2_iter = {'n': 0}
def _imshow(name, frame):
    pass
def _waitKey(delay=0):
    try: time.sleep(max(0, (delay or 1))/1000.0)
    except Exception: pass
    _cv2_iter['n'] += 1
    # auto-break loops after ~40 iterations so 'while True' with waitKey exits cleanly
    if _cv2_iter['n'] > 40:
        return 13  # Enter key
    return -1
def _destroy(*a, **kw): pass
_cv2.imshow = _imshow
_cv2.waitKey = _waitKey
_cv2.destroyAllWindows = _destroy
_cv2.destroyWindow = _destroy
_cv2.namedWindow = _destroy
sys.modules['cv2'] = _cv2
`;


export default function IDE() {
  const [fs, setFs] = useState<FSMap>({});
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  const [serverUrl, setServerUrl] = useState<string>("");

  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("explorer");
  const [bottomTab, setBottomTab] = useState<BottomTab>("terminal");
  const [bottomExpanded, setBottomExpanded] = useState(true);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [outputLog, setOutputLog] = useState<LogLine[]>([]);
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [webcamOn, setWebcamOn] = useState(false);
  const [aiChat, setAiChat] = useState<{ role: "user" | "ai"; text: string }[]>([]);
  const [aiInput, setAiInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [settings, setSettings] = useState({ fontSize: 14, tabSize: 2, wordWrap: true, theme: "sam-dark" as "sam-dark" | "vs-dark" });
  const [renameOf, setRenameOf] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; path: string } | null>(null);

  const editorRef = useRef<any>(null);
  const editorElRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<any>(null);
  const termElRef = useRef<HTMLDivElement | null>(null);
  const fitRef = useRef<any>(null);
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const toggleWebcamRef = useRef<(() => Promise<void>) | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const askGroq = useServerFn(chatWithGroq);
  const [aiBusy, setAiBusy] = useState(false);
  const termInputBufRef = useRef<string>("");
  const termCwdRef = useRef<string>("");
  const pythonInputResolverRef = useRef<((v: string) => void) | null>(null);
  const handleTermCommandRef = useRef<((cmd: string, term: any) => Promise<void>) | null>(null);
  const runPkgCommandRef = useRef<((bin: string, args: string[], cwd: string, write: (s: string) => void, runLine?: (l: string) => Promise<void>) => Promise<boolean>) | null>(null);
  const nodeServerRef = useRef<VirtualServer | null>(null);
  const terminalProcessActiveRef = useRef(false);
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);



  // Toolchain / LIBRARY state
  const [installed, setInstalled] = useState<Installed>(() => ({ runtimes: {}, packages: {} }));
  const installedRef = useRef<Installed>({ runtimes: {}, packages: {} });
  const [extQuery, setExtQuery] = useState("");
  const [extTab, setExtTab] = useState<"runtimes" | "packages">("runtimes");
  const [extBusy, setExtBusy] = useState(false);
  const [extHits, setExtHits] = useState<SearchHit[]>([]);
  const [extVersions, setExtVersions] = useState<Record<string, string[]>>({});

  // Load FS from localStorage or seed defaults
  useEffect(() => {
    const stored = loadFS();
    const init = Object.keys(stored).length > 0 ? stored : { ...DEFAULT_FS };
    const state = loadInstalled();
    installedRef.current = state;
    setInstalled(state);
    setFs(syncLibrary(init, state));
    if (init["index.html"]) {
      setOpenTabs(["index.html"]);
      setActiveFile("index.html");
    }
  }, []);






  // Apply an install/uninstall: persists state and mirrors it into LIBRARY/
  const applyInstalled = useCallback((mutate: (s: Installed) => Installed) => {
    const next = mutate({
      runtimes: { ...installedRef.current.runtimes },
      packages: Object.fromEntries(
        Object.entries(installedRef.current.packages).map(([k, v]) => [k, { ...v }]),
      ),
    });
    installedRef.current = next;
    setInstalled(next);
    saveInstalled(next);
    setFs((prev) => syncLibrary(prev, next));
  }, []);

  const recordPackage = useCallback((lang: string, name: string, version: string) => {
    applyInstalled((s) => {
      s.packages[lang] = { ...(s.packages[lang] || {}), [name]: version };
      return s;
    });
  }, [applyInstalled]);

  const removePackage = useCallback((lang: string, name: string) => {
    applyInstalled((s) => {
      if (s.packages[lang]) delete s.packages[lang][name];
      return s;
    });
  }, [applyInstalled]);

  const setRuntimeVersion = useCallback((id: string, v: string) => {
    applyInstalled((s) => { s.runtimes[id] = v; return s; });
    toast.success(`Switched to version ${v}`);
  }, [applyInstalled]);

  const loadRuntimeVersions = useCallback(async (rt: Runtime) => {
    setExtBusy(true);
    try {
      const list = await fetchRuntimeVersions(rt.id);
      setExtVersions((p) => ({ ...p, [rt.id]: list }));
    } catch (e: any) {
      toast.error(`Couldn't fetch versions: ${e?.message || e}`);
    } finally {
      setExtBusy(false);
    }
  }, []);

  const runExtSearch = useCallback(async () => {
    const q = extQuery.trim();
    if (!q) return;
    setExtBusy(true);
    setExtHits([]);
    try {
      const [npm, pypi] = await Promise.all([
        searchNpm(q).catch(() => [] as SearchHit[]),
        searchPypi(q).catch(() => [] as SearchHit[]),
      ]);
      setExtHits([...pypi, ...npm]);
    } finally {
      setExtBusy(false);
    }
  }, [extQuery]);

  const installHit = useCallback((hit: SearchHit) => {
    recordPackage(hit.registry === "pypi" ? "python" : "node", hit.name, hit.version);
    toast.success(`Installed ${hit.name}@${hit.version} → ${LIBRARY}/${hit.registry === "pypi" ? "python" : "node"}`);
  }, [recordPackage]);




  // Persist FS
  useEffect(() => {
    if (Object.keys(fs).length) saveFS(fs);
  }, [fs]);

  // Mount Monaco
  useEffect(() => {
    let disposed = false;
    let model: any;
    (async () => {
      await ensureMonaco();
      if (disposed || !editorElRef.current) return;
      if (!editorRef.current) {
        editorRef.current = window.monaco.editor.create(editorElRef.current, {
          value: "",
          language: "plaintext",
          theme: settings.theme,
          fontSize: settings.fontSize,
          tabSize: settings.tabSize,
          wordWrap: settings.wordWrap ? "on" : "off",
          minimap: { enabled: true },
          automaticLayout: true,
          smoothScrolling: true,
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          fontLigatures: true,
          renderLineHighlight: "all",
          scrollBeyondLastLine: false,
        });
        editorRef.current.onDidChangeModelContent(() => {
          const path = (editorRef.current as any)._samPath as string | undefined;
          if (!path) return;
          const value = editorRef.current.getValue();
          setFs((prev) => {
            const node = prev[path];
            if (!node || node.type !== "file") return prev;
            if (node.content === value) return prev;
            return { ...prev, [path]: { ...node, content: value } };
          });
          setDirty((d) => {
            if (d.has(path)) return d;
            const n = new Set(d);
            n.add(path);
            return n;
          });
          validate(path, value);
        });
        // Ctrl+S
        editorRef.current.addCommand(
          window.monaco.KeyMod.CtrlCmd | window.monaco.KeyCode.KeyS,
          () => saveActive(),
        );
      }
    })();
    return () => {
      disposed = true;
      model = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply settings to editor
  useEffect(() => {
    if (!editorRef.current || !window.monaco) return;
    editorRef.current.updateOptions({
      fontSize: settings.fontSize,
      tabSize: settings.tabSize,
      wordWrap: settings.wordWrap ? "on" : "off",
    });
    window.monaco.editor.setTheme(settings.theme);
  }, [settings]);

  // Switch model on activeFile change
  useEffect(() => {
    (async () => {
      await ensureMonaco();
      if (!editorRef.current) return;
      if (!activeFile) {
        editorRef.current.setModel(null);
        return;
      }
      const node = fs[activeFile];
      if (!node || node.type !== "file") return;
      const ext = extname(activeFile);
      // Non-text viewers handled separately; skip Monaco for binary
      if (IMG_EXT.has(ext) || VID_EXT.has(ext) || AUD_EXT.has(ext) || PDF_EXT.has(ext)) {
        editorRef.current.setModel(null);
        return;
      }
      const uri = window.monaco.Uri.parse("inmemory://model/" + activeFile);
      let m = window.monaco.editor.getModel(uri);
      if (!m) {
        m = window.monaco.editor.createModel(node.content, LANG_MAP[ext] || "plaintext", uri);
      } else if (m.getValue() !== node.content) {
        m.setValue(node.content);
      }
      editorRef.current.setModel(m);
      (editorRef.current as any)._samPath = activeFile;
      validate(activeFile, node.content);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile]);

  // Validation (simple): JSON parse, JS syntax via Function
  const validate = useCallback((path: string, content: string) => {
    const ext = extname(path);
    const newProbs: Problem[] = [];
    if (ext === "json") {
      try { JSON.parse(content); }
      catch (e: any) {
        const m = /at position (\d+)/.exec(e.message);
        const pos = m ? parseInt(m[1]) : 0;
        const upTo = content.slice(0, pos);
        const line = upTo.split("\n").length;
        const col = pos - upTo.lastIndexOf("\n");
        newProbs.push({ file: path, line, col, message: e.message, severity: "error" });
      }
    } else if (ext === "js" || ext === "mjs" || ext === "cjs") {
      try { new Function(content); }
      catch (e: any) {
        const m = /<anonymous>:(\d+):(\d+)/.exec(e.stack || "");
        newProbs.push({
          file: path,
          line: m ? parseInt(m[1]) : 1,
          col: m ? parseInt(m[2]) : 1,
          message: e.message,
          severity: "error",
        });
      }
    }
    setProblems((prev) => {
      const others = prev.filter((p) => p.file !== path);
      return [...others, ...newProbs];
    });
    // Apply markers
    if (window.monaco && editorRef.current?.getModel()) {
      const model = editorRef.current.getModel();
      window.monaco.editor.setModelMarkers(model, "sam-validator",
        newProbs.map((p) => ({
          severity: window.monaco.MarkerSeverity.Error,
          startLineNumber: p.line, startColumn: p.col,
          endLineNumber: p.line, endColumn: p.col + 1,
          message: p.message,
        })),
      );
    }
  }, []);

  const saveActive = useCallback(() => {
    if (!activeFile) return;
    setDirty((d) => { const n = new Set(d); n.delete(activeFile); return n; });
    toast.success(`Saved ${basename(activeFile)}`);
  }, [activeFile]);

  const saveAll = useCallback(() => {
    setDirty(new Set());
    toast.success("All files saved");
  }, []);

  const openFile = useCallback((path: string) => {
    setActiveFile(path);
    setOpenTabs((t) => (t.includes(path) ? t : [...t, path]));
  }, []);

  const closeTab = useCallback((path: string) => {
    setOpenTabs((tabs) => {
      const idx = tabs.indexOf(path);
      const next = tabs.filter((p) => p !== path);
      if (activeFile === path) {
        setActiveFile(next[Math.max(0, idx - 1)] ?? next[0] ?? null);
      }
      return next;
    });
  }, [activeFile]);

  // ===== File operations =====
  const newFile = useCallback((parent = "") => {
    const name = prompt("File name (e.g. app.js or src/util.ts):", "untitled.txt");
    if (!name) return;
    const full = normalize(parent ? `${parent}/${name}` : name);
    if (fs[full]) { toast.error("File already exists"); return; }
    setFs((prev) => {
      const next = { ...prev };
      ensureFolders(next, full);
      next[full] = { type: "file", content: "" };
      return next;
    });
    openFile(full);
  }, [fs, openFile]);

  const newFolder = useCallback((parent = "") => {
    const name = prompt("Folder name:", "new-folder");
    if (!name) return;
    const full = normalize(parent ? `${parent}/${name}` : name);
    if (fs[full]) { toast.error("Folder already exists"); return; }
    setFs((prev) => {
      const next = { ...prev };
      ensureFolders(next, full + "/.keep");
      next[full] = { type: "folder" };
      return next;
    });
    setExpanded((e) => { const n = new Set(e); n.add(full); return n; });
  }, [fs]);

  const deleteAt = useCallback((path: string) => {
    if (!confirm(`Delete ${path}?`)) return;
    setFs((prev) => { const next = { ...prev }; deletePath(next, path); return next; });
    setOpenTabs((t) => t.filter((p) => p !== path && !p.startsWith(path + "/")));
    if (activeFile === path || activeFile?.startsWith(path + "/")) setActiveFile(null);
  }, [activeFile]);

  const renameAt = useCallback((path: string) => {
    setRenameOf(path);
    setRenameValue(basename(path));
  }, []);

  const commitRename = useCallback(() => {
    if (!renameOf) return;
    const newName = renameValue.trim();
    if (!newName || newName === basename(renameOf)) { setRenameOf(null); return; }
    const newPath = normalize(dirname(renameOf) ? `${dirname(renameOf)}/${newName}` : newName);
    setFs((prev) => {
      const next = { ...prev };
      if (renamePath(next, renameOf, newPath)) {
        setOpenTabs((tabs) => tabs.map((t) => (t === renameOf ? newPath : t.startsWith(renameOf + "/") ? newPath + t.slice(renameOf.length) : t)));
        if (activeFile === renameOf) setActiveFile(newPath);
      } else {
        toast.error("Rename failed");
      }
      return next;
    });
    setRenameOf(null);
  }, [renameOf, renameValue, activeFile]);

  const duplicateAt = useCallback((path: string) => {
    const node = fs[path];
    if (!node || node.type !== "file") return;
    const ext = extname(path);
    const base = basename(path).replace(/\.[^.]+$/, "");
    const dir = dirname(path);
    let i = 1;
    while (fs[normalize(dir ? `${dir}/${base}_copy${i}${ext ? "." + ext : ""}` : `${base}_copy${i}${ext ? "." + ext : ""}`)]) i++;
    const np = normalize(dir ? `${dir}/${base}_copy${i}${ext ? "." + ext : ""}` : `${base}_copy${i}${ext ? "." + ext : ""}`);
    setFs((prev) => ({ ...prev, [np]: { ...node } }));
  }, [fs]);

  const uploadFiles = useCallback(async (files: FileList | null, parent = "") => {
    if (!files || !files.length) return;
    const list = Array.from(files);
    const total = list.length;
    const big = list.some((f) => f.size > 8 * 1024 * 1024);
    const tid = toast.loading(`Uploading ${total} file${total === 1 ? "" : "s"}...`);
    const updates: FSMap = {};
    let done = 0;
    for (const f of list) {
      const rel = (f as any).webkitRelativePath && (f as any).webkitRelativePath.length
        ? (f as any).webkitRelativePath as string
        : f.name;
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      const isBinary = !isTextLikeFile(f.name, ext, f.type);

      const path = normalize(parent ? `${parent}/${rel}` : rel);
      if (isBinary) {
        // Chunked base64 — handles multi-hundred-MB files without blowing the
        // call stack or freezing the tab.
        const buf = await f.arrayBuffer();
        const bytes = new Uint8Array(buf);
        const CHUNK = 0x8000;
        let bin = "";
        for (let i = 0; i < bytes.length; i += CHUNK) {
          bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as any);
          if (i % (CHUNK * 64) === 0) await new Promise((r) => setTimeout(r, 0));
        }
        updates[path] = { type: "file", content: btoa(bin), binary: true, mime: f.type || "application/octet-stream" };
      } else {
        updates[path] = { type: "file", content: await f.text() };
      }
      done++;
      if (total > 5 && done % 5 === 0) toast.loading(`Uploading ${done}/${total}...`, { id: tid });
    }
    setFs((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(updates)) { ensureFolders(next, k); next[k] = updates[k]; }
      return next;
    });
    if (parent) setExpanded((e) => new Set(e).add(parent));
    toast.success(`Uploaded ${total} file${total === 1 ? "" : "s"}${big ? " (large files kept in memory for this session)" : ""}`, { id: tid });
  }, []);


  const downloadFile = useCallback((path: string) => {
    const node = fs[path];
    if (!node || node.type !== "file") return;
    let blob: Blob;
    if (node.binary) {
      const bin = atob(node.content);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      blob = new Blob([arr], { type: node.mime || "application/octet-stream" });
    } else {
      blob = new Blob([node.content], { type: "text/plain;charset=utf-8" });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = basename(path); a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [fs]);

  // ===== Run / Preview =====
  const findRunnableHtml = useCallback((target: string | null): string | null => {
    if (!target) return null;
    const node = fs[target];
    if (!node) return null;
    if (node.type === "file" && extname(target) === "html") return target;
    if (node.type === "folder") {
      // Look for index.html / first .html in folder
      const kids = listChildren(fs, target);
      const idx = kids.find((k) => k.name.toLowerCase() === "index.html");
      if (idx) return idx.path;
      const any = kids.find((k) => k.node.type === "file" && extname(k.path) === "html");
      if (any) return any.path;
    }
    // If editing CSS/JS in a folder, find a sibling html
    if (node.type === "file") {
      const dir = dirname(target);
      const kids = listChildren(fs, dir);
      const idx = kids.find((k) => k.name.toLowerCase() === "index.html");
      if (idx) return idx.path;
      const any = kids.find((k) => k.node.type === "file" && extname(k.path) === "html");
      if (any) return any.path;
    }
    return null;
  }, [fs]);

  // Run a Python file with its whole project folder (and sub-folders) mounted,
  // so `import helper`, open("data/x.txt"), etc. resolve exactly like on a PC.
  const runPythonFile = useCallback(async (path: string, pushOut: (t: string, l?: LogLine["level"]) => void) => {
    const root = projectRootFor(fs, path);
    const rel = root ? path.slice(root.length + 1) : path;
    const source = fs[path] && fs[path].type === "file" ? (fs[path] as any).content : "";
    const usesCv2 = /\bimport\s+cv2\b|\bfrom\s+cv2\b/.test(source);
    if (usesCv2 && !webcamOn) {
      pushOut("cv2 detected — opening browser webcam (Pyodide can't access native cameras)...", "info");
      try { await toggleWebcamRef.current?.(); } catch {}
    }
    const runOnce = async () => {
      const py = await ensurePyodide(
        (s) => pushOut(s, "log"),
        (s) => pushOut(s, "error"),
      );
      py.globals.set("__sam_input", (msg: string) => {
        const v = window.prompt(msg || "Input:");
        return v == null ? "" : v;
      });
      await py.runPythonAsync(`import builtins\nbuiltins.input = __sam_input`);
      await mountPythonProject(py, fs, root);
      if (usesCv2) {
        await py.runPythonAsync(CV2_SHIM);
        pushOut("Live webcam feed is shown in the Webcam panel on the right. imshow() is a no-op in the browser; VideoCapture.read() returns empty frames. Loops using cv2.waitKey exit automatically after ~40 iterations.", "info");
      }
      // Execute as __main__ from inside the project root so relative imports work
      await py.runPythonAsync(
        `import runpy, sys\nsys.argv = [${JSON.stringify(rel)}]\nrunpy.run_path(${JSON.stringify(rel)}, run_name="__main__")`,
      );
    };
    try {
      await runOnce();
    } catch (e: any) {
      if (isFatalPyError(e)) {
        pushOut("Python runtime crashed — reloading a fresh interpreter and retrying...", "info");
        resetPyodide();
        await runOnce();
        return;
      }
      throw e;
    }
  }, [fs, webcamOn]);

  const findRunnableEntry = useCallback((target: string): string | null => {
    const node = fs[target];
    if (node && node.type === "file") return target;
    const kids = listChildren(fs, target);
    const byName = (n: string) => kids.find((k) => k.name.toLowerCase() === n)?.path;
    return (
      byName("run.bat") || byName("run.cmd") || byName("run.sh") ||
      byName("index.html") || byName("main.py") || byName("app.py") ||
      kids.find((k) => k.node.type === "file" && ["html", "py"].includes(extname(k.path)))?.path || null
    );
  }, [fs]);

  /** Push a runtime/terminal error into the Problems panel (bottom bar). */
  const reportProblem = useCallback((file: string, message: string, line = 1, col = 1, severity: Problem["severity"] = "error") => {
    setProblems((prev) => [
      ...prev.filter((p) => !(p.file === file && p.message === message)),
      { file, line, col, message, severity },
    ]);
  }, []);

  /** Serve a folder statically → renders its index.html in the Preview tab. */
  const startStaticServer = useCallback((dir: string, write: (s: string) => void, port = 3000) => {
    const candidates = [
      `${dir}/index.html`, `${dir}/public/index.html`, `${dir}/dist/index.html`,
      `${dir}/build/index.html`, `${dir}/src/index.html`, dir ? "" : "index.html",
    ].filter(Boolean);
    const idx = candidates.find((p) => fs[p] && fs[p].type === "file");
    if (!idx) {
      write(`serve: no index.html found in ${dir || "/"}\n`);
      reportProblem(dir || "/", `serve: no index.html found in ${dir || "/"}`);
      return false;
    }
    const html = buildPreviewHtml(fs, idx, dir);
    setPreviewHtml(html);
    setBottomTab("preview");
    setBottomExpanded(true);
    try {
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      setServerUrl(url);
      write(
        `\x1b[32m  Serving!\x1b[0m\n  - Local:   http://localhost:${port}\n  - Entry:   ${idx}\n  - Root:    ${dir || "/"}\n  - Open:    ${url}\n  (live in the Preview tab — press ⧉ to open it in a new tab)\n`,
      );
    } catch {
      write(`\x1b[32m  Serving!\x1b[0m\n  - Local:  http://localhost:${port}\n  - Root:   ${dir || "/"}\n`);
    }
    return true;
  }, [fs, reportProblem]);

  /**
   * Run a Node.js entry file inside the in-browser Node runtime. If it starts
   * an HTTP server (express / http.createServer), the Preview tab is wired to
   * that server: fetch, XHR and socket.io calls from the page hit the real
   * route handlers defined in the project.
   */
  const startNodeServer = useCallback(async (entry: string, write: (s: string) => void) => {
    const root = projectRootFor(fs, entry);
    stopAllServers();
    nodeServerRef.current = null;
    let server: VirtualServer | null = null;
    try {
      server = await runNodeFile(fs, root, entry, {
        write: (s) => write(s),
        error: (s) => { write(`\x1b[31m${s}\x1b[0m\n`); reportProblem(entry, s.replace(/\x1b\[[0-9;]*m/g, "")); },
      });
    } catch (e: any) {
      const msg = String(e?.message || e);
      write(`\x1b[31m${msg}\x1b[0m\n`);
      reportProblem(entry, msg);
      return false;
    }
    if (!server) return true; // plain script, ran to completion
    nodeServerRef.current = server;
    terminalProcessActiveRef.current = true;

    // Build the page the server would serve at "/" and connect it to the server.
    const idx = [
      ...server.staticDirs.map((d) => `${d}/index.html`),
      `${root}/public/index.html`, `${root}/static/index.html`, `${root}/views/index.html`,
      `${root}/index.html`, root ? "" : "index.html",
    ].filter(Boolean).find((p) => fs[p] && fs[p].type === "file");

    let html = "";
    if (idx) html = buildPreviewHtml(fs, idx, root);
    else {
      const res = await server.handle({ method: "GET", url: "/", headers: {} });
      html = res.isBase64 ? atob(res.body) : res.body;
    }
    html = html
      .replace(
        /\b(?:window\.)?location\.href\s*=\s*(?!=)([^;\n]+);?/g,
        "window.__samNavigate($1);",
      )
      .replace(
        /\b(?:window\.)?location\.(?:assign|replace)\s*\(/g,
        "window.__samNavigate(",
      );
    const bridge = clientBridgeScript(server.port);
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1>${bridge}`) : bridge + html;
    setPreviewHtml(html);
    // This is a virtual browser server, not a TCP listener on the user's
    // machine. The toolbar opens the connected page in a normal browser tab.
    setServerUrl(`virtual://localhost:${server.port}`);
    setBottomTab("preview");
    setBottomExpanded(true);
    write(
      `\n  - Local:   \x1b[36mhttp://localhost:${server.port}\x1b[0m\n  - Root:    ${root || "/"}\n` +
      `  - Entry:   ${idx || "(served by route handlers)"}\n` +
      `  \x1b[90mThe app is live in Preview. Use the Preview ↗ button for a connected browser tab.\x1b[0m\n` +
      `  \x1b[33mThe virtual localhost/ngrok text is not a network URL; it only works through this IDE.\x1b[0m\n` +
      `  \x1b[90mPress Ctrl+C to stop the server.\x1b[0m\n`,
    );
    return true;
  }, [fs, reportProblem]);



  /**
   * Full npm / bun / yarn / pnpm / npx emulation, shared by the terminal and
   * .bat/.sh script execution. Runs inside `cwd` (the selected folder).
   */
  const runPkgCommand = useCallback(async (
    bin: string,
    args: string[],
    cwd: string,
    write: (s: string) => void,
    runLine?: (line: string) => Promise<void>,
  ): Promise<boolean> => {
    const resolve = (p: string) => normalize(p.replace(/\\/g, "/").replace(/^["']|["']$/g, "").startsWith("/") ? p.replace(/^["']|["']$/g, "").slice(1) : cwd ? `${cwd}/${p.replace(/\\/g, "/").replace(/^["']|["']$/g, "")}` : p.replace(/^["']|["']$/g, ""));
    const pkgPath = resolve("package.json");
    const readPkg = () => {
      const n = fs[pkgPath];
      if (n && n.type === "file") { try { return JSON.parse(n.content); } catch { return null; } }
      return null;
    };
    const writePkg = (obj: any) => setFs((prev) => {
      const next = { ...prev };
      ensureFolders(next, pkgPath);
      next[pkgPath] = { type: "file", content: JSON.stringify(obj, null, 2) };
      return next;
    });
    const flags = args.filter((a) => a.startsWith("-"));
    const rest = args.filter((a) => !a.startsWith("-"));
    const sub = (rest[0] || "").toLowerCase();
    const NPM_VERSION = "10.9.0";

    if (flags.some((f) => /^(-v|--version)$/i.test(f)) && !sub) {
      const v = bin === "bun" ? "1.1.38" : bin === "yarn" ? "4.5.3" : bin === "pnpm" ? "9.14.4" : NPM_VERSION;
      write(`${v}\n`);
      return true;
    }

    // npx <cmd> — run a binary / local script
    if (bin === "npx") {
      const cmd = rest[0] || "";
      if (!cmd) { write("npx: missing command\n"); return true; }
      if (/^(serve|http-server|live-server|vite|serve-static)$/.test(cmd)) {
        const targetArg = rest[1] && rest[1] !== "." ? resolve(rest[1]) : cwd;
        startStaticServer(targetArg, write);
        return true;
      }
      if (runLine) { await runLine([cmd, ...rest.slice(1)].join(" ")); return true; }
      write(`npx: '${cmd}' is not available in the browser sandbox.\n`);
      return true;
    }

    if (!sub || sub === "help") {
      write(`${bin} <init|install|uninstall|update|outdated|run|start|test|audit|cache|list|-v>\n`);
      return true;
    }

    if (sub === "init") {
      const existing = readPkg();
      const obj = existing || {
        name: (basename(cwd) || "app").toLowerCase().replace(/\s+/g, "-"),
        version: "1.0.0",
        description: "",
        main: "index.js",
        type: "module",
        scripts: { start: "node index.js", dev: "npx serve .", build: "echo no build step", test: "echo no tests" },
        keywords: [],
        author: "",
        license: "ISC",
        dependencies: {},
        devDependencies: {},
      };
      writePkg(obj);
      write(`Wrote to ${pkgPath}:\n\n${JSON.stringify(obj, null, 2)}\n\n`);
      return true;
    }

    if (["install", "i", "add"].includes(sub)) {
      const names = rest.slice(1);
      const dev = flags.some((f) => /^(-D|--save-dev)$/.test(f));
      const pkg = readPkg() || { name: basename(cwd) || "app", version: "1.0.0", dependencies: {}, devDependencies: {} };
      if (!names.length) {
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        const keys = Object.keys(deps);
        if (!keys.length) { write("up to date, audited 0 packages in 0.2s\n\nfound 0 vulnerabilities\n"); return true; }
        for (const k of keys) { recordPackage("node", k, String(deps[k]).replace(/^[^\d]*/, "") || "latest"); write(`  added ${k}@${deps[k]}\n`); }
        write(`\nadded ${keys.length} package${keys.length === 1 ? "" : "s"} in 1s\n\nfound 0 vulnerabilities\n`);
        return true;
      }
      for (const raw of names) {
        const at = raw.lastIndexOf("@");
        const name = at > 0 ? raw.slice(0, at) : raw;
        const wanted = at > 0 ? raw.slice(at + 1) : "";
        write(`${bin}: resolving ${name}...\n`);
        try {
          const versions = await fetchVersions("npm", name);
          const v = wanted && versions.includes(wanted) ? wanted : versions[0] || "latest";
          recordPackage("node", name, v);
          const bucket = dev ? "devDependencies" : "dependencies";
          pkg[bucket] = { ...(pkg[bucket] || {}), [name]: `^${v}` };
          write(`\x1b[32m+ ${name}@${v}\x1b[0m \x1b[90m→ ${LIBRARY}/node/packages\x1b[0m\n`);
        } catch (e: any) {
          write(`\x1b[31mnpm ERR! 404 Not Found - ${name}\x1b[0m\n`);
          reportProblem(pkgPath, `npm install ${name} failed: ${e?.message || e}`);
        }
      }
      writePkg(pkg);
      write(`\nadded ${names.length} package${names.length === 1 ? "" : "s"}, and audited ${names.length} packages\n\nfound 0 vulnerabilities\n`);
      return true;
    }

    if (["uninstall", "remove", "rm", "un"].includes(sub)) {
      const pkg = readPkg();
      for (const name of rest.slice(1)) {
        removePackage("node", name);
        if (pkg) { delete pkg.dependencies?.[name]; delete pkg.devDependencies?.[name]; }
        write(`removed ${name}\n`);
      }
      if (pkg) writePkg(pkg);
      return true;
    }

    if (sub === "update" || sub === "up" || sub === "upgrade") {
      const pkg = readPkg();
      const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
      const names = rest.slice(1).length ? rest.slice(1) : Object.keys(deps);
      if (!names.length) { write("up to date\n"); return true; }
      for (const name of names) {
        try {
          const v = (await fetchVersions("npm", name))[0] || "latest";
          recordPackage("node", name, v);
          if (pkg) {
            if (pkg.devDependencies?.[name]) pkg.devDependencies[name] = `^${v}`;
            else pkg.dependencies = { ...(pkg.dependencies || {}), [name]: `^${v}` };
          }
          write(`  updated ${name} → ${v}\n`);
        } catch { write(`\x1b[31mnpm ERR! could not update ${name}\x1b[0m\n`); }
      }
      if (pkg) writePkg(pkg);
      write(`\nchanged ${names.length} packages\n`);
      return true;
    }

    if (sub === "outdated") {
      const pkg = readPkg();
      const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
      const keys = Object.keys(deps);
      if (!keys.length) { write("(no dependencies)\n"); return true; }
      write(`Package${" ".repeat(18)}Current   Latest\n`);
      for (const k of keys) {
        const current = String(deps[k]).replace(/^\^|~/, "");
        let latest = current;
        try { latest = (await fetchVersions("npm", k))[0] || current; } catch { /* offline */ }
        const line = `${k.padEnd(25)}${current.padEnd(10)}${latest}`;
        write(latest !== current ? `\x1b[33m${line}\x1b[0m\n` : `${line}\n`);
      }
      return true;
    }

    if (sub === "audit") {
      if (rest[1] === "fix") { write("up to date, audited packages in 0.4s\n\nfixed 0 of 0 vulnerabilities\n"); return true; }
      write("found 0 vulnerabilities\n");
      return true;
    }

    if (sub === "cache") {
      write(`npm cache ${rest.slice(1).join(" ") || "clean"}: cache cleared\n`);
      return true;
    }

    if (["list", "ls", "ll"].includes(sub)) {
      const pkg = readPkg();
      const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
      const installedNode = installedRef.current.packages.node || {};
      const all = { ...installedNode, ...deps };
      const keys = Object.keys(all).sort();
      write(`${pkg?.name || basename(cwd) || "app"}@${pkg?.version || "1.0.0"} ${cwd || "/"}\n`);
      write(keys.length ? keys.map((k, i) => `${i === keys.length - 1 ? "└──" : "├──"} ${k}@${String(all[k]).replace(/^\^|~/, "")}`).join("\n") + "\n" : "└── (empty)\n");
      return true;
    }

    // run / start / test / build / dev
    const scriptName = sub === "run" || sub === "run-script" ? rest[1] : sub;
    if (scriptName) {
      const pkg = readPkg();
      const scripts = pkg?.scripts || {};
      const fallbackName = scriptName === "dev" && !scripts.dev && scripts.start ? "start" : scriptName;
      const command = scripts[fallbackName];
      if (!command) {
        write(`\x1b[31mnpm ERR! Missing script: "${scriptName}"\x1b[0m\n`);
        if (Object.keys(scripts).length) write(`\nAvailable scripts:\n${Object.keys(scripts).map((s) => `  ${s}`).join("\n")}\n`);
        reportProblem(pkgPath, `Missing npm script: "${scriptName}"`);
        return true;
      }
      if (fallbackName !== scriptName) write(`\x1b[33mnpm notice: no "dev" script; running "start" instead.\x1b[0m\n`);
      write(`\n> ${pkg?.name || "app"}@${pkg?.version || "1.0.0"} ${fallbackName}\n> ${command}\n\n`);
      for (const part of String(command).split("&&").map((s) => s.trim()).filter(Boolean)) {
        const [pbin, ...pargs] = part.split(/\s+/);
        if (["npm", "npx", "bun", "yarn", "pnpm"].includes(pbin)) { await runPkgCommandRef.current?.(pbin, pargs, cwd, write, runLine); continue; }
        if (/^(serve|http-server|vite|live-server)$/.test(pbin)) { startStaticServer(pargs[0] && pargs[0] !== "." ? resolve(pargs[0]) : cwd, write); continue; }
        if (runLine) await runLine(part);
        else write(`${part}\n`);
      }
      return true;
    }

    write(`Unknown ${bin} command: ${sub}\n`);
    return true;
  }, [fs, recordPackage, removePackage, reportProblem, startStaticServer]);
  runPkgCommandRef.current = runPkgCommand;


  // Run a .bat / .cmd / .sh script: executes each line inside the script's folder.
  const runScriptFile = useCallback(async (path: string, pushOut: (t: string, l?: LogLine["level"]) => void) => {
    const root = projectRootFor(fs, path);
    const content = (fs[path] as any)?.content || "";
    const rawLines = parseScriptCommands(content);
    let cwd = root;
    let errorlevel = 0;
    let skipDepth = 0; // inside a skipped if(...) block

    for (let i = 0; i < rawLines.length; i++) {
      // strip cmd redirections (>nul 2>&1) and trailing carets
      let line = rawLines[i].replace(/\s*\d?>+\s*(nul|NUL|\/dev\/null)\b/g, "").replace(/\s*2>&1/g, "").trim();
      if (!line) continue;

      // --- batch control flow: if errorlevel N ( ... )
      if (skipDepth > 0) {
        if (/\($/.test(line)) skipDepth++;
        if (/^\)/.test(line)) skipDepth--;
        continue;
      }
      const ifMatch = /^if\s+(not\s+)?errorlevel\s+(\d+)\s*\(?$/i.exec(line);
      if (ifMatch) {
        const negate = !!ifMatch[1];
        let cond = errorlevel >= parseInt(ifMatch[2], 10);
        if (negate) cond = !cond;
        if (!cond) { skipDepth = 1; }
        continue;
      }
      if (/^\)\s*else\s*\(?$/i.test(line)) { skipDepth = 1; continue; }
      if (/^\)$/.test(line)) continue;
      if (/^(goto|:|@?exit\b|endlocal|setlocal|title|color|cls|mode)/i.test(line)) continue;

      pushOut(`${cwd || "/"}> ${line}`, "info");
      const [bin, ...args] = line.split(/\s+/);
      const b = bin.toLowerCase();
      const resolve = (p: string) => {
        const clean = p.replace(/\\/g, "/").replace(/^["']|["']$/g, "").replace(/%~dp0/gi, "");
        return normalize(clean.startsWith("/") ? clean.slice(1) : cwd ? `${cwd}/${clean}` : clean);
      };
      const write = (s: string) => s.split("\n").forEach((l, idx, arr) => { if (l || idx < arr.length - 1) pushOut(l.replace(/\x1b\[[0-9;]*m/g, "")); });
      const runLine = async (l: string) => {
        rawLines.splice(i + 1, 0, l); // execute the expanded command next
      };

      if (b === "echo") { pushOut(args.join(" ").replace(/^\.$/, "")); continue; }
      if (b === "pause") { pushOut("(press any key to continue — skipped)"); continue; }
      if (b === "rem" || b === "::") continue;
      if (b === "cd" || b === "chdir") {
        const t = args.filter((a) => !/^\/[a-z]$/i.test(a)).join(" ");
        const next = t ? resolve(t) : cwd;
        if (!t || next === root || next === "") cwd = t ? next : cwd;
        if (fs[next] && fs[next].type === "folder") cwd = next;
        else if (next === "" || next === root) cwd = next;
        else pushOut(`The system cannot find the path specified: ${t}`, "error");
        continue;
      }

      // node / npm / npx / bun / yarn / pnpm
      if (["npm", "npx", "bun", "yarn", "pnpm"].includes(b)) {
        errorlevel = 0;
        await runPkgCommandRef.current?.(b, args, cwd, write, runLine);
        continue;
      }
      if (b === "node" && args.some((a) => /^(-v|--version)$/.test(a))) {
        const v = installedRef.current.runtimes.node || "22.11.0";
        pushOut(`v${v}`);
        errorlevel = 0;
        continue;
      }
      if (b === "python" || b === "python3" || b === "py") {
        const t = args.find((a) => !a.startsWith("-"));
        if (args.some((a) => /^(-V|--version)$/.test(a))) { pushOut(`Python ${installedRef.current.runtimes.python || "3.12.1"}`); errorlevel = 0; continue; }
        const target = t ? resolve(t) : "";
        if (!fs[target] || fs[target].type !== "file") {
          pushOut(`python: can't open file '${t}'`, "error");
          reportProblem(path, `python: can't open file '${t}'`);
          errorlevel = 1;
          continue;
        }
        try { await runPythonFile(target, pushOut); errorlevel = 0; }
        catch (e: any) { pushOut(String(e?.message || e), "error"); reportProblem(target, String(e?.message || e)); errorlevel = 1; }
        continue;
      }
      if (b === "pip" || b === "pip3") {
        if (args[0] !== "install") { pushOut("Only `pip install` is supported here.", "error"); errorlevel = 1; continue; }
        const pkgs = args.slice(1).filter((a) => !a.startsWith("-"));
        try {
          const py = await ensurePyodide((s) => pushOut(s), (s) => pushOut(s, "error"));
          const mp = py.pyimport("micropip");
          for (const raw of pkgs) {
            const pkg = PIP_ALIAS[raw] || raw;
            pushOut(`Collecting ${pkg}...`);
            try { try { await py.loadPackage(pkg); } catch { await mp.install(pkg); } pushOut(`✓ installed ${pkg}`); }
            catch (e: any) { pushOut(`ERROR: could not install ${pkg}: ${e?.message || e}`, "error"); reportProblem(path, `pip install ${pkg} failed`); errorlevel = 1; }
          }
        } catch (e: any) { pushOut(String(e?.message || e), "error"); errorlevel = 1; }
        continue;
      }
      if (b === "node") {
        const t = args.find((a) => !a.startsWith("-"));
        const target = t ? resolve(t) : "";
        const n = fs[target];
        if (!n || n.type !== "file") { pushOut(`node: cannot find '${t}'`, "error"); reportProblem(path, `node: cannot find module '${t}'`); errorlevel = 1; continue; }
        try { await startNodeServer(target, write); errorlevel = 0; }
        catch (e: any) { pushOut(String(e?.message || e), "error"); reportProblem(target, String(e?.message || e)); errorlevel = 1; }
        continue;
      }
      if (b === "serve" || b === "http-server" || b === "live-server") {
        const dirArg = args.find((a) => !a.startsWith("-"));
        startStaticServer(dirArg && dirArg !== "." ? resolve(dirArg) : cwd, write);
        continue;
      }
      if (b === "start" || b === "explorer") {
        const t = args.filter((a) => a.replace(/"/g, "").trim()).map((a) => a.replace(/"/g, "")).filter(Boolean);
        const file = t.length ? resolve(t[t.length - 1]) : "";
        if (fs[file] && extname(file) === "html") { setPreviewHtml(buildPreviewHtml(fs, file, projectRootFor(fs, file))); setBottomTab("preview"); setBottomExpanded(true); pushOut(`Opened ${file} in the Preview tab`); }
        else if (fs[file] && fs[file].type === "folder") startStaticServer(file, write);
        else pushOut(`start: ${args.join(" ")}`);
        continue;
      }
      if (b === "call" || b === "cmd" || b === "bash" || b === "sh") {
        const t = args.find((a) => /\.(bat|cmd|sh)$/i.test(a));
        if (t) { await runScriptFile(resolve(t), pushOut); continue; }
        const inner = args.filter((a) => !/^\/[a-z]$/i.test(a));
        if (inner.length) {
          const [ib, ...iargs] = inner;
          if (["npm", "npx", "bun", "yarn", "pnpm"].includes(ib.toLowerCase())) { await runPkgCommandRef.current?.(ib.toLowerCase(), iargs, cwd, write, runLine); continue; }
          rawLines.splice(i + 1, 0, inner.join(" "));
          continue;
        }
      }
      if (b === "set" || b === "title" || b === "color") continue;
      pushOut(`'${bin}' is not recognized as an internal or external command.`, "error");
      reportProblem(path, `'${bin}' is not recognized as an internal or external command.`, i + 1);
      errorlevel = 9009;
    }
  }, [fs, runPythonFile, reportProblem, startStaticServer]);


  /**
   * Execute a .bat / .cmd / .sh in the REAL terminal: each line is typed into
   * the shell exactly like cmd.exe would, inside the script's own folder, so
   * `npm install` / `npm run dev` create files in that folder and the dev
   * server link + preview come from the same session.
   */
  const runScriptInTerminal = useCallback(async (path: string) => {
    setBottomTab("terminal");
    setBottomExpanded(true);
    // Wait for xterm to mount (it is created lazily when the tab shows).
    for (let i = 0; i < 60 && !termRef.current; i++) await new Promise((r) => setTimeout(r, 100));
    const term = termRef.current;
    if (!term) { toast.error("Terminal not ready"); return; }
    const node = fs[path];
    if (!node || node.type !== "file") return;
    const dir = dirname(path);
    termCwdRef.current = dir;
    setSelectedFolder(dir);
    const write = (s: string) => term.write(s.replace(/\n/g, "\r\n"));
    write(`\r\n\x1b[38;5;39m▶ ${path}\x1b[0m\n`);
    const cmds = parseScriptCommands(node.content);
    let skipFailedBlock = 0;
    for (const raw of cmds) {
      const line = raw
        .replace(/\s*\d?>\s*(nul|\/dev\/null)\b/gi, "")
        .replace(/\s*2>&1/g, "")
        .replace(/%~dp0/g, dir ? dir + "/" : "")
        .replace(/^call\s+/i, "")
        .trim();
      if (!line) continue;
      if (skipFailedBlock > 0) {
        if (/\($/.test(line)) skipFailedBlock++;
        if (/^\)/.test(line)) skipFailedBlock--;
        continue;
      }
      // Package/runtime commands in this browser shell report failures directly.
      // Their successful completion means cmd.exe's `if errorlevel 1 (...)`
      // branch must be skipped rather than executing its error messages.
      if (/^if\s+errorlevel\s+1\s*\(?$/i.test(line)) {
        skipFailedBlock = 1;
        continue;
      }
      if (/^(pause|exit)\b/i.test(line)) continue;
      if (/^(if|else|goto|:)/i.test(line)) continue; // control flow handled by the Output runner
      write(`\r\n\x1b[38;5;39m${termCwdRef.current || "~"}\x1b[0m \x1b[38;5;213m$\x1b[0m ${line}\r\n`);
      try {
        await handleTermCommandRef.current?.(line, term);
        if (terminalProcessActiveRef.current) return;
      } catch (e: any) {
        write(`\x1b[31m${String(e?.message || e)}\x1b[0m\n`);
        reportProblem(path, String(e?.message || e));
      }
    }
    write(`\r\n\x1b[32m✓ ${basename(path)} finished\x1b[0m\r\n`);
    write(`\r\n\x1b[38;5;39m${termCwdRef.current || "~"}\x1b[0m \x1b[38;5;213m$\x1b[0m `);
  }, [fs, reportProblem]);

  const runActive = useCallback(async () => {
    const target = selectedFolder && fs[selectedFolder]?.type === "folder" ? selectedFolder : activeFile;
    if (!target) { toast.error("Select a file or folder first"); return; }
    const entry = findRunnableEntry(target) || target;

    const ext = extname(entry);
    setOutputLog([]);
    const pushOut = (text: string, level: LogLine["level"] = "log") =>
      setOutputLog((l) => [...l, { level, text }]);
    if (["bat", "cmd", "sh"].includes(ext)) {
      // Real terminal execution (cmd-style), plus a mirrored log in Output.
      pushOut(`▶ Running ${entry} in the terminal...`, "info");
      await runScriptInTerminal(entry);
    } else if (ext === "html" || ext === "css" || ext === "js") {

      const html = findRunnableHtml(entry);
      if (!html) { toast.error("No HTML file found in folder"); return; }
      setPreviewHtml(buildPreviewHtml(fs, html));
      setBottomTab("preview");
      setBottomExpanded(true);
      toast.success(`Running ${html}`);
    } else if (ext === "py") {
      setBottomTab("output");
      setBottomExpanded(true);
      pushOut(`▶ Running ${entry}...`, "info");
      try {
        await runPythonFile(entry, pushOut);
        pushOut(`✓ Finished`, "info");
      } catch (e: any) {
        pushOut(String(e?.message || e), "error");
        setProblems((p) => [
          ...p.filter((x) => x.file !== entry),
          { file: entry, line: 1, col: 1, message: String(e?.message || e), severity: "error" },
        ]);
      }
    } else if (ext === "ts" || ext === "tsx" || ext === "jsx" || ext === "mjs" || ext === "cjs") {
      runJsInSandbox(((fs[entry] as any)?.content) || "");
    } else if (["c","cpp","java","php"].includes(ext)) {
      toast.error(`${ext.toUpperCase()} needs a backend runner (Docker). Not available in static deploy.`);
      setOutputLog([{ level: "error", text: `${ext.toUpperCase()} compilation requires a server-side runner with GCC/JDK/PHP. This IDE runs in your browser.` }]);
      setBottomTab("output"); setBottomExpanded(true);
    } else {
      toast.error(`Don't know how to run .${ext}`);
    }
  }, [activeFile, selectedFolder, fs, findRunnableHtml, findRunnableEntry, runPythonFile, runScriptInTerminal]);

  const runJsInSandbox = useCallback((code: string) => {
    setBottomTab("output"); setBottomExpanded(true);
    const html = `<!doctype html><script>
${code}
</script>`;
    setPreviewHtml(buildPreviewHtml({ "__run.html": { type: "file", content: html } }, "__run.html"));
    setBottomTab("preview"); setBottomExpanded(true);
  }, []);

  // Capture preview console/error messages
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as any;
      if (!d) return;
      // --- virtual Node server bridge (preview page ⇄ express / socket.io) ---
      if (d.__vnode) {
        const srv = nodeServerRef.current;
        const src = (e.source as Window) || previewFrameRef.current?.contentWindow || null;
        if (!srv || !src) return;
        if (d.kind === "http") {
          srv.handle({ method: d.method, url: d.url, headers: d.headers || {}, body: d.body, isBase64: /multipart|octet/.test(String(d.headers?.["content-type"] || "")) })
            .then((res) => {
              const headers = { ...res.headers };
              const vfsPath = headers["x-sam-vfs-path"];
              delete headers["x-sam-vfs-path"];
              let body = res.body;
              const contentType = String(headers["content-type"] || "");
              if (!res.isBase64 && contentType.includes("text/html")) {
                if (vfsPath && fs[vfsPath]?.type === "file") {
                  body = buildPreviewHtml(fs, vfsPath, srv.root);
                }
                body = body
                  .replace(
                    /\b(?:window\.)?location\.href\s*=\s*(?!=)([^;\n]+);?/g,
                    "window.__samNavigate($1);",
                  )
                  .replace(
                    /\b(?:window\.)?location\.(?:assign|replace)\s*\(/g,
                    "window.__samNavigate(",
                  );
                const bridge = clientBridgeScript(srv.port, d.url || "/");
                body = /<head[^>]*>/i.test(body)
                  ? body.replace(/<head([^>]*)>/i, `<head$1>${bridge}`)
                  : bridge + body;
              }
              src.postMessage({ __vnodeRes: true, kind: "http", id: d.id, ...res, headers, body }, "*");
            })
            .catch((err) => src.postMessage({ __vnodeRes: true, kind: "http", id: d.id, status: 500, headers: {}, body: String(err?.message || err) }, "*"));
        } else if (d.kind === "sock") {
          if (d.op === "connect") {
            srv.hub.connect(d.sid, (event, args) => src.postMessage({ __vnodeRes: true, kind: "sock", sid: d.sid, event, args }, "*"));
          } else if (d.op === "emit") srv.hub.receive(d.sid, d.event, d.args || []);
          else if (d.op === "disconnect") srv.hub.disconnect(d.sid);
        }
        return;
      }
      if (!d.__samIde) return;
      if (d.kind === "console") {
        setOutputLog((l) => [...l, { level: d.level, text: (d.args || []).join(" ") }]);
      } else if (d.kind === "error") {
        const text = `${d.message}${d.source ? ` (${basename(d.source)}:${d.line}:${d.col})` : ""}`;
        setOutputLog((l) => [...l, { level: "error", text }]);
        setProblems((p) => [
          ...p,
          { file: d.source ? basename(d.source) : "preview", line: d.line || 1, col: d.col || 1, message: d.message, severity: "error" },
        ]);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [fs]);

  // ===== Terminal =====
  useEffect(() => {
    if (bottomTab !== "terminal" || !bottomExpanded) return;
    let cancelled = false;
    (async () => {
      const xtermUrl = "https://cdn.jsdelivr.net/npm/xterm@5.3.0/+esm";
      const fitUrl = "https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/+esm";
      const [{ Terminal: TerminalCtor }, { FitAddon: FitAddonCtor }] = await Promise.all([
        import(/* @vite-ignore */ xtermUrl),
        import(/* @vite-ignore */ fitUrl),
      ]);
      if (cancelled || !termElRef.current) return;
      if (!termRef.current) {
        const term = new TerminalCtor({
          theme: { background: "#0b1124", foreground: "#e7ecff", cursor: "#7aa2ff" },
          fontFamily: "JetBrains Mono, Fira Code, ui-monospace, monospace",
          fontSize: 14, lineHeight: 1.25, cursorBlink: true, convertEol: true,
        });
        const fit = new FitAddonCtor();
        term.loadAddon(fit);
        term.open(termElRef.current);
        fit.fit();
        termRef.current = term; fitRef.current = fit;
        const prompt = () =>
          term.write(`\r\n\x1b[38;5;39m${termCwdRef.current || "~"}\x1b[0m \x1b[38;5;213m$\x1b[0m `);
        term.write(
          "\x1b[1;38;5;39mSam Cloud IDE Terminal\x1b[0m\r\n" +
            "Type \x1b[33mhelp\x1b[0m for available commands.",
        );
        prompt();
        term.onData((data: string) => {
          if (pythonInputResolverRef.current) {
            if (data === "\r") {
              term.write("\r\n");
              const v = termInputBufRef.current;
              termInputBufRef.current = "";
              pythonInputResolverRef.current(v);
              pythonInputResolverRef.current = null;
              return;
            }
            if (data === "\u007f") {
              if (termInputBufRef.current.length) { termInputBufRef.current = termInputBufRef.current.slice(0, -1); term.write("\b \b"); }
              return;
            }
            termInputBufRef.current += data;
            term.write(data);
            return;
          }
          if (data === "\r") {
            if (terminalProcessActiveRef.current) return;
            const cmd = termInputBufRef.current.trim();
            termInputBufRef.current = "";
            term.write("\r\n");
            // Always use the latest command handler (state such as cwd, fs and
            // installed packages changes between renders).
            Promise.resolve(handleTermCommandRef.current?.(cmd, term))
              .catch((e: any) => term.write(`\r\n\x1b[31m${String(e?.message || e)}\x1b[0m`))
              .then(() => { if (!terminalProcessActiveRef.current) prompt(); });
            return;
          }
          if (data === "\u007f") {
            if (termInputBufRef.current.length) { termInputBufRef.current = termInputBufRef.current.slice(0, -1); term.write("\b \b"); }
            return;
          }
          if (data === "\u0003") {
            term.write("^C");
            termInputBufRef.current = "";
            if (terminalProcessActiveRef.current) {
              nodeServerRef.current?.close();
              nodeServerRef.current = null;
              terminalProcessActiveRef.current = false;
              setServerUrl("");
              term.write("\r\n\x1b[33mServer stopped.\x1b[0m");
            }
            prompt();
            return;
          }
          if (data === "\u0015") { // Ctrl+U — clear the line
            while (termInputBufRef.current.length) { termInputBufRef.current = termInputBufRef.current.slice(0, -1); term.write("\b \b"); }
            return;
          }
          if (data.charCodeAt(0) === 27) return; // ignore arrow/escape sequences
          termInputBufRef.current += data;
          term.write(data);
        });
      } else {
        try { fitRef.current?.fit(); } catch {}
      }
      // The terminal container stays mounted but hidden between tabs, so xterm
      // can measure 0px and paint blank. Refit + repaint once it is visible.
      const repaint = () => {
        try {
          fitRef.current?.fit();
          termRef.current?.refresh(0, Math.max(0, (termRef.current?.rows ?? 1) - 1));
        } catch {}
      };
      requestAnimationFrame(repaint);
      setTimeout(repaint, 120);
      setTimeout(repaint, 400);
      // Refit on container resize
      if (termElRef.current && !(termElRef.current as any)._samRO) {
        const ro = new ResizeObserver(() => { try { fitRef.current?.fit(); } catch {} });
        ro.observe(termElRef.current);
        (termElRef.current as any)._samRO = ro;
      }

    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottomTab, bottomExpanded]);

  const handleTermCommand = useCallback(async (cmd: string, term: any) => {
    if (!cmd) return;
    const [bin, ...args] = cmd.split(/\s+/);
    const cwd = termCwdRef.current;
    const resolve = (p: string) => normalize(p.startsWith("/") ? p.slice(1) : cwd ? `${cwd}/${p}` : p);
    const write = (s: string) => term.write(s.replace(/\n/g, "\r\n"));

    // --- version flags: `python --version`, `node -v`, `java -version`, ... ---
    const versionFlag = args.find((a) => /^(--version|-v|-V|--v|-version)$/i.test(a));
    if (versionFlag) {
      const rt = runtimeFor(bin);
      if (rt) {
        const v = installedRef.current.runtimes[rt.id] || rt.version;
        const label = bin === "node" || bin === "bun" ? `v${v}` : `${rt.name.split(" ")[0]} ${v}`;
        write(`${label}\n`);
        return;
      }
    }

    // --- npm / bun / yarn / pnpm / npx package manager ---
    if (["npm", "bun", "yarn", "pnpm", "npx"].includes(bin)) {
      await runPkgCommandRef.current?.(bin, args, cwd, write, async (l: string) => {
        await handleTermCommandRef.current?.(l, term);
      });
      return;
    }


    switch (bin) {
      case "help":
        write("Commands:\n  ls / cd / pwd / cat / mkdir / touch / rm / mv / echo / clear\n  <lang> --version            print installed version (python, node, java, gcc, php, tsc...)\n  versions                    list every language + installed version\n  pip install|uninstall|list <pkg>   Python packages (Pyodide + LIBRARY)\n  npm|bun|yarn|pnpm install|remove|list|run|init   Node packages (LIBRARY)\n  npx <cmd>                   run a script\n  python <file>               run a Python file (project-rooted)\n  node <file>                 run a JS/TS file (sandbox)\n  run                         run active file (like ▶ Run)\n  open <file>                 open file in editor\n  run.bat / run.sh            execute a script file line by line\n  help                        this help\n");
        return;
      case "versions": {
        for (const r of RUNTIMES) {
          const v = installedRef.current.runtimes[r.id] || r.version;
          write(`  \x1b[38;5;39m${r.name.padEnd(22)}\x1b[0m ${v}\n`);
        }
        return;
      }

      case "clear":
      case "cls": term.clear(); return;
      case "title": case "color": case "mode": case "setlocal": case "endlocal": case "rem": return;
      case "pause": write("Press any key to continue . . . (skipped)\n"); return;
      case "pwd": write((cwd || "/") + "\n"); return;
      case "echo.": write("\n"); return;
      case "echo": write(args.join(" ").replace(/^\.$/, "") + "\n"); return;
      case "ls": {
        const target = args[0] ? resolve(args[0]) : cwd;
        const kids = listChildren(fs, target);
        if (!kids.length) { write("(empty)\n"); return; }
        write(kids.map((k) => (k.node.type === "folder" ? `\x1b[38;5;39m${k.name}/\x1b[0m` : k.name)).join("  ") + "\n");
        return;
      }
      case "cd": {
        const t = args[0] ? resolve(args[0]) : "";
        if (t === "" || (fs[t] && fs[t].type === "folder")) { termCwdRef.current = t; }
        else write(`cd: no such folder: ${t}\n`);
        return;
      }
      case "cat": {
        const t = args[0] ? resolve(args[0]) : "";
        const n = fs[t];
        if (!n || n.type !== "file") { write(`cat: ${t}: no such file\n`); return; }
        write((n.content || "") + "\n");
        return;
      }
      case "mkdir": {
        if (!args[0]) { write("mkdir: missing operand\n"); return; }
        const t = resolve(args[0]);
        setFs((prev) => { const next = { ...prev }; ensureFolders(next, t + "/.keep"); next[t] = { type: "folder" }; return next; });
        return;
      }
      case "touch": {
        if (!args[0]) { write("touch: missing operand\n"); return; }
        const t = resolve(args[0]);
        setFs((prev) => { if (prev[t]) return prev; const next = { ...prev }; ensureFolders(next, t); next[t] = { type: "file", content: "" }; return next; });
        return;
      }
      case "rm": {
        if (!args[0]) { write("rm: missing operand\n"); return; }
        const t = resolve(args[0]);
        setFs((prev) => { const next = { ...prev }; deletePath(next, t); return next; });
        return;
      }
      case "pip":
      case "pip3": {
        const sub = args[0];
        if (["uninstall", "remove"].includes(sub || "")) {
          for (const name of args.slice(1).filter((a) => !a.startsWith("-"))) {
            removePackage("python", PIP_ALIAS[name] || name);
            write(`Successfully uninstalled ${name}\n`);
          }
          return;
        }
        if (["list", "freeze"].includes(sub || "")) {
          const pkgs = installedRef.current.packages.python || {};
          const keys = Object.keys(pkgs).sort();
          write(keys.length ? keys.map((k) => `  ${k}==${pkgs[k]}`).join("\n") + "\n" : "(no packages installed)\n");
          return;
        }
        if (sub !== "install" || !args[1]) { write("Usage: pip install|uninstall|list <package> [pkg2 ...]\n"); return; }
        const pkgs = args.slice(1).filter(a => !a.startsWith("-"));
        try {
          const py = await ensurePyodide((s) => write(s + "\n"), (s) => write(`\x1b[31m${s}\x1b[0m\n`));
          const mp = py.pyimport("micropip");
          for (const raw of pkgs) {
            const pkg = PIP_ALIAS[raw] || raw;
            if (pkg !== raw) write(`\x1b[90m(mapped ${raw} → ${pkg})\x1b[0m\n`);
            write(`Collecting ${pkg}...\n`);
            try {
              // Try Pyodide's built-in first (faster, supports numpy/pandas/opencv-python etc.)
              try { await py.loadPackage(pkg); }
              catch { await mp.install(pkg); }
              let v = "latest";
              try { v = String(await py.runPythonAsync(`import importlib.metadata as m; m.version(${JSON.stringify(pkg)})`)); } catch { /* ignore */ }
              recordPackage("python", pkg, v);
              write(`\x1b[32m✓ Successfully installed ${pkg}-${v}\x1b[0m \x1b[90m→ ${LIBRARY}/python/packages\x1b[0m\n`);
            } catch (e: any) {
              write(`\x1b[31mERROR: could not install ${pkg}: ${e?.message || e}\x1b[0m\n`);
            }
          }
        } catch (e: any) {
          write(`\x1b[31mERROR: ${e?.message || e}\x1b[0m\n`);
        }
        return;
      }

      case "ls-installed":
      case "pip-list": {
        try {
          const py = await ensurePyodide(() => {}, () => {});
          const res = await py.runPythonAsync(`import pkgutil; '\\n'.join(sorted(m.name for m in pkgutil.iter_modules()))`);
          write(String(res) + "\n");
        } catch (e: any) { write(`\x1b[31m${e?.message || e}\x1b[0m\n`); }
        return;
      }
      case "python":
      case "python3": {
        const t = args[0] ? resolve(args[0]) : "";
        const n = fs[t];
        if (!n || n.type !== "file") { write(`python: can't open file '${t}'\n`); return; }
        try {
          const py = await ensurePyodide((s) => write(s + "\n"), (s) => write(`\x1b[31m${s}\x1b[0m\n`));
          py.globals.set("__term_input", (msg: string) => new Promise<string>((res) => {
            write(msg || "");
            pythonInputResolverRef.current = res;
          }));
          await py.runPythonAsync(`import builtins\ndef __sync_input(p=""): \n    import js\n    v = js.prompt(p)\n    return v if v is not None else ''\nbuiltins.input = __sync_input`);
          const root = projectRootFor(fs, t);
          const rel = root ? t.slice(root.length + 1) : t;
          await mountPythonProject(py, fs, root);
          await py.runPythonAsync(`import runpy, sys\nsys.argv = [${JSON.stringify(rel)}]\nrunpy.run_path(${JSON.stringify(rel)}, run_name="__main__")`);
        } catch (e: any) {
          write(`\x1b[31m${e?.message || e}\x1b[0m\n`);
        }
        return;
      }
      case "node": {
        const t = args.find((a) => !a.startsWith("-"));
        const target = t ? resolve(t) : "";
        const n = fs[target];
        if (!n || n.type !== "file") { write(`node: cannot find module '${t || ""}'\n`); return; }
        await startNodeServer(target, write);
        return;
      }
      case "mv": {
        if (!args[0] || !args[1]) { write("mv: usage: mv <src> <dst>\n"); return; }
        const a = resolve(args[0]); const b = resolve(args[1]);
        setFs((prev) => { const next = { ...prev }; if (!renamePath(next, a, b)) { write(`mv: failed\n`); } return next; });
        return;
      }
      case "open": {
        const t = args[0] ? resolve(args[0]) : "";
        if (fs[t] && (fs[t] as any).type === "file") { openFile(t); write(`Opened ${t}\n`); }
        else write(`open: no such file: ${t}\n`);
        return;
      }
      case "run": runActive(); return;
      case "": return;
      default: {
        // Allow executing scripts directly: run.bat, ./run.sh, cake/run.cmd
        const cand = resolve(bin.replace(/^\.\//, ""));
        if (fs[cand] && fs[cand].type === "file" && /\.(bat|cmd|sh)$/i.test(cand)) {
          const prevCwd = termCwdRef.current;
          termCwdRef.current = dirname(cand);
          write(`\x1b[90m▶ ${cand}\x1b[0m\n`);
          for (const raw of parseScriptCommands((fs[cand] as any).content)) {
            const line = raw
              .replace(/\s*\d?>\s*(nul|\/dev\/null)\b/gi, "")
              .replace(/\s*2>&1/g, "")
              .replace(/%~dp0/g, dirname(cand) ? dirname(cand) + "/" : "")
              .replace(/^call\s+/i, "")
              .trim();
            if (!line || /^(pause|exit|if|else|goto|:)/i.test(line)) continue;
            write(`\x1b[38;5;39m${termCwdRef.current || "~"}\x1b[0m \x1b[38;5;213m$\x1b[0m ${line}\n`);
            try { await handleTermCommandRef.current?.(line, term); }
            catch (e: any) { write(`\x1b[31m${String(e?.message || e)}\x1b[0m\n`); reportProblem(cand, String(e?.message || e)); }
            if (terminalProcessActiveRef.current) return;
          }
          write(`\x1b[32m✓ ${basename(cand)} finished\x1b[0m\n`);
          if (!fs[termCwdRef.current]) termCwdRef.current = prevCwd;
          return;
        }
        write(`\x1b[31m${bin}: command not found\x1b[0m — type \x1b[33mhelp\x1b[0m for commands\n`);
        return;
      }
    }
  }, [fs, runActive, runScriptFile, recordPackage, removePackage, reportProblem]);

  handleTermCommandRef.current = handleTermCommand;


  // ===== Webcam =====
  const toggleWebcam = useCallback(async () => {
    if (webcamOn) {
      webcamStreamRef.current?.getTracks().forEach((t) => t.stop());
      webcamStreamRef.current = null;
      setWebcamOn(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      webcamStreamRef.current = stream;
      setWebcamOn(true);
      setTimeout(() => {
        if (webcamVideoRef.current) {
          webcamVideoRef.current.srcObject = stream;
          webcamVideoRef.current.play().catch(() => {});
        }
      }, 50);
    } catch (e: any) {
      toast.error("Camera access denied: " + (e?.message || e));
    }
  }, [webcamOn]);
  toggleWebcamRef.current = toggleWebcam;



  const openWebcamInNewTab = useCallback(() => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>Webcam</title><style>html,body{margin:0;background:#000;height:100%;display:grid;place-items:center}video{max-width:100%;max-height:100%}</style></head><body><video id="v" autoplay playsinline></video><script>navigator.mediaDevices.getUserMedia({video:true}).then(s=>{document.getElementById('v').srcObject=s})</script></body></html>`);
  }, []);

  // ===== Right-click menu close on outside =====
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [ctxMenu]);

  // ===== Keyboard shortcuts =====
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "s") { e.preventDefault(); if (e.shiftKey) saveAll(); else saveActive(); }
      else if ((e.ctrlKey || e.metaKey) && k === "n") { e.preventDefault(); if (e.shiftKey) newFolder(); else newFile(); }
      else if ((e.ctrlKey || e.metaKey) && k === "b") { e.preventDefault(); setSidebarTab((s) => (s === "explorer" ? "search" : "explorer")); }
      else if ((e.ctrlKey || e.metaKey) && e.key === "`") { e.preventDefault(); setBottomTab("terminal"); setBottomExpanded((x) => !x); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveActive, saveAll, newFile, newFolder]);

  // ===== Render helpers =====
  const renderTree = useCallback((folder: string, depth = 0): React.ReactNode => {
    const kids = listChildren(fs, folder);
    return kids.map((k) => {
      const isFolder = k.node.type === "folder";
      const isExpanded = expanded.has(k.path);
      const isActive = activeFile === k.path;
      return (
        <div key={k.path}>
          <div
            className={`tree-row group ${isActive || (isFolder && selectedFolder === k.path) ? "selected" : ""}`}
            style={{ paddingLeft: 8 + depth * 12, ...(isFolder && selectedFolder === k.path ? { boxShadow: "inset 2px 0 0 oklch(0.72 0.18 240)" } : {}) }}
            onClick={() => {
              if (isFolder) {
                // Select this folder as the working directory (like clicking a
                // project folder in VS Code) and toggle it open.
                setSelectedFolder(k.path);
                termCwdRef.current = k.path;
                try {
                  const t = termRef.current;
                  if (t) {
                    // Drop whatever half-typed text was in the input buffer so
                    // the next command isn't concatenated to it (e.g. "npmnpm").
                    termInputBufRef.current = "";
                    t.write(`\r\n\x1b[90mcd ${k.path}\x1b[0m\r\n\x1b[38;5;39m${k.path}\x1b[0m \x1b[38;5;213m$\x1b[0m `);
                  }
                } catch {}

                setExpanded((e) => { const n = new Set(e); if (n.has(k.path)) n.delete(k.path); else n.add(k.path); return n; });
              } else { setSelectedFolder(dirname(k.path)); openFile(k.path); }
            }}

            onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, path: k.path }); }}
          >
            {isFolder ? (
              <>
                <i className={`bi ${isExpanded ? "bi-chevron-down" : "bi-chevron-right"}`} style={{ fontSize: 10, width: 12 }} />
                <i className="bi bi-folder-fill" style={{ color: "#7aa2ff" }} />
              </>
            ) : (
              <>
                <span style={{ width: 12 }} />
                <FileIcon name={k.name} />
              </>
            )}
            {renameOf === k.path ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenameOf(null); }}
                className="bg-[oklch(0.1_0.02_260)] text-white px-1 rounded text-xs flex-1 outline-none border border-[oklch(0.72_0.18_240)]"
              />
            ) : (
              <span className="truncate flex-1">{k.name}</span>
            )}
            {dirty.has(k.path) && <span className="w-1.5 h-1.5 rounded-full bg-white/80" />}
            {renameOf !== k.path && (
              <span className="tree-actions ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {isFolder && (
                  <>
                    <button title="New file" onClick={(e) => { e.stopPropagation(); newFile(k.path); }} className="hover:text-white text-muted-foreground"><i className="bi bi-file-earmark-plus" /></button>
                    <button title="New folder" onClick={(e) => { e.stopPropagation(); newFolder(k.path); }} className="hover:text-white text-muted-foreground"><i className="bi bi-folder-plus" /></button>
                  </>
                )}
                <button title="Rename" onClick={(e) => { e.stopPropagation(); renameAt(k.path); }} className="hover:text-white text-muted-foreground"><i className="bi bi-pencil" /></button>
                <button title="Delete" onClick={(e) => { e.stopPropagation(); deleteAt(k.path); }} className="hover:text-destructive text-muted-foreground"><i className="bi bi-trash" /></button>
              </span>
            )}
          </div>
          {isFolder && isExpanded && renderTree(k.path, depth + 1)}
        </div>
      );
    });
  }, [fs, expanded, activeFile, selectedFolder, renameOf, renameValue, commitRename, openFile, dirty]);

  // AI assistant powered by Groq
  const sendAi = useCallback(async () => {
    if (!aiInput.trim() || aiBusy) return;
    const q = aiInput.trim();
    const history = [...aiChat, { role: "user" as const, text: q }];
    setAiChat(history);
    setAiInput("");
    setAiBusy(true);
    try {
      const code = activeFile && fs[activeFile]?.type === "file" ? (fs[activeFile] as any).content : "";
      const sys = `You are a helpful coding assistant embedded in Sam Cloud IDE (browser IDE with Monaco, Pyodide, xterm.js).
Reply in concise markdown. ALWAYS wrap every code sample in a fenced code block with a language tag (e.g. \`\`\`python, \`\`\`html, \`\`\`js). Never present code as plain text — the UI renders fenced blocks with a Copy button.
${activeFile ? `Active file: ${activeFile}\n\`\`\`${extname(activeFile) || ""}\n${code.slice(0, 6000)}\n\`\`\`` : "No file is currently open."}
${problems.length ? `Current problems:\n${problems.slice(0, 8).map(p => `- ${p.file}:${p.line} — ${p.message}`).join("\n")}` : ""}`;
      const messages = [
        { role: "system" as const, content: sys },
        ...history.map(m => ({ role: m.role === "ai" ? ("assistant" as const) : ("user" as const), content: m.text })),
      ];
      const res = await askGroq({ data: { messages } });
      setAiChat((c) => [...c, { role: "ai", text: res.text || "(empty response)" }]);
    } catch (e: any) {
      setAiChat((c) => [...c, { role: "ai", text: `⚠️ ${e?.message || e}` }]);
    } finally {
      setAiBusy(false);
    }
  }, [aiInput, aiBusy, aiChat, activeFile, fs, problems, askGroq]);

  const activeNode = activeFile ? fs[activeFile] : null;
  const activeExt = activeFile ? extname(activeFile) : "";
  const isImg = IMG_EXT.has(activeExt);
  const isVid = VID_EXT.has(activeExt);
  const isAud = AUD_EXT.has(activeExt);
  const isPdf = PDF_EXT.has(activeExt);

  const dataUrl = useMemo(() => {
    if (!activeNode || activeNode.type !== "file" || !activeNode.binary) return null;
    return `data:${activeNode.mime || "application/octet-stream"};base64,${activeNode.content}`;
  }, [activeNode]);

  const previewWidth = previewDevice === "mobile" ? 390 : previewDevice === "tablet" ? 768 : "100%";

  return (
    <div className="h-screen w-screen flex flex-col text-foreground">
      {/* Top Title Bar */}
      <div className="glass-strong flex items-center gap-1 px-3 py-2 border-b border-white/10 z-20 shrink-0">
        <div className="flex items-center gap-2 px-2 mr-2">
          <div className="w-7 h-7 rounded-lg grid place-items-center bg-gradient-to-br from-[oklch(0.6_0.22_240)] to-[oklch(0.5_0.25_290)] pulse-neon">
            <i className="bi bi-code-slash text-white text-sm" />
          </div>
          <div className="font-semibold text-sm tracking-tight">
            Sam <span className="neon-text">Cloud</span> IDE
          </div>
        </div>
        <div className="h-5 w-px bg-white/10 mx-2" />
        <button className="titlebar-btn" onClick={() => newFile()}><i className="bi bi-file-earmark-plus" /> New</button>
        <button className="titlebar-btn" onClick={() => newFolder()}><i className="bi bi-folder-plus" /> Folder</button>
        <button className="titlebar-btn" onClick={() => fileInputRef.current?.click()}><i className="bi bi-file-earmark-arrow-up" /> Upload Files</button>
        <button className="titlebar-btn" onClick={() => folderInputRef.current?.click()}><i className="bi bi-folder-symlink" /> Upload Folder</button>
        <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => { uploadFiles(e.target.files); e.target.value = ""; }} />
        <input
          ref={folderInputRef}
          type="file"
          hidden
          multiple
          // @ts-expect-error non-standard directory attributes for folder upload
          webkitdirectory=""
          directory=""
          onChange={(e) => { uploadFiles(e.target.files); e.target.value = ""; }}
        />
        <button className="titlebar-btn" onClick={() => activeFile && downloadFile(activeFile)}><i className="bi bi-download" /> Download</button>
        <button className="titlebar-btn" onClick={saveActive}><i className="bi bi-save" /> Save</button>
        <button className="titlebar-btn" onClick={saveAll}><i className="bi bi-save2" /> Save All</button>
        <div className="h-5 w-px bg-white/10 mx-2" />
        <button className="titlebar-btn !text-[oklch(0.85_0.18_145)] hover:!text-[oklch(0.9_0.2_145)]" onClick={runActive}><i className="bi bi-play-fill" /> Run</button>
        {selectedFolder && (
          <span className="ml-1 px-2 py-0.5 rounded-md text-[11px] bg-white/5 border border-white/10 text-muted-foreground" title="Selected working folder — terminal commands run here">
            <i className="bi bi-folder-fill mr-1" style={{ color: "#7aa2ff" }} />{selectedFolder}
          </span>
        )}

        <button className="titlebar-btn" onClick={() => {
          nodeServerRef.current?.close();
          nodeServerRef.current = null;
          terminalProcessActiveRef.current = false;
          setServerUrl("");
          setPreviewHtml("");
          setOutputLog([]);
          if (termRef.current) termRef.current.write("\r\n\x1b[33mServer stopped.\x1b[0m");
        }}><i className="bi bi-stop-fill" /> Stop</button>
        <div className="ml-auto flex items-center gap-1">
          <button className={`titlebar-btn ${webcamOn ? "!text-[oklch(0.85_0.18_25)]" : ""}`} onClick={toggleWebcam}>
            <i className="bi bi-camera-video-fill" /> {webcamOn ? "Camera On" : "Camera"}
          </button>
          <button className="titlebar-btn" onClick={() => setSidebarTab("settings")}><i className="bi bi-gear" /></button>
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-pink-400 to-violet-500 grid place-items-center text-xs font-bold ml-1">S</div>
        </div>
      </div>

      {/* Main row */}
      <div className="flex-1 min-h-0 flex">
        {/* Activity bar */}
        <div className="glass-strong w-14 flex flex-col items-center py-2 border-r border-white/10 shrink-0">
          {([
            ["explorer","files","Explorer"],
            ["search","search","Search"],
            ["git","git","Source Control"],
            ["debug","bug","Debug"],
            ["extensions","puzzle","Extensions"],
            ["ai","robot","AI Assistant"],
            ["settings","gear","Settings"],
          ] as [SidebarTab, string, string][]).map(([id, icon, label]) => (
            <div
              key={id}
              className={`sidebar-icon ${sidebarTab === id ? "active" : ""}`}
              title={label}
              onClick={() => setSidebarTab(id)}
            >
              <i className={`bi bi-${icon}`} />
            </div>
          ))}
        </div>

        <PanelGroup orientation="horizontal" className="flex-1 min-w-0" resizeTargetMinimumSize={{ fine: 22, coarse: 34 }}>
          {/* Side panel */}
          <Panel defaultSize="22%" minSize="240px" maxSize="42%">
            <div className="h-full glass flex flex-col">
              <div className="px-4 py-3 text-xs uppercase tracking-widest text-muted-foreground flex items-center justify-between border-b border-white/5">
                <span>{sidebarTab}</span>
                {sidebarTab === "explorer" && (
                  <div className="flex gap-2 text-sm">
                    <button title="New File" onClick={() => newFile()} className="hover:text-white"><i className="bi bi-file-earmark-plus" /></button>
                    <button title="New Folder" onClick={() => newFolder()} className="hover:text-white"><i className="bi bi-folder-plus" /></button>
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-auto scroll-thin py-1">
                {sidebarTab === "explorer" && (
                  <div onContextMenu={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, path: "" }); }}}>
                    {renderTree("")}
                  </div>
                )}
                {sidebarTab === "search" && (
                  <div className="p-3 space-y-2">
                    <input
                      placeholder="Search files..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-[oklch(0.1_0.02_260)] border border-white/10 rounded px-2 py-1.5 text-sm outline-none focus:border-[oklch(0.72_0.18_240)]"
                    />
                    {searchQuery && (
                      <div className="space-y-1 text-sm">
                        {Object.entries(fs).flatMap(([p, n]) => {
                          if (n.type !== "file" || (n as any).binary) return [];
                          const matches: { line: number; text: string }[] = [];
                          (n as any).content.split("\n").forEach((ln: string, i: number) => {
                            if (ln.toLowerCase().includes(searchQuery.toLowerCase())) matches.push({ line: i + 1, text: ln.trim().slice(0, 80) });
                          });
                          return matches.length ? [{ path: p, matches }] : [];
                        }).map((r) => (
                          <div key={r.path} className="mb-2">
                            <div className="text-[oklch(0.72_0.18_240)] font-medium cursor-pointer" onClick={() => openFile(r.path)}>{r.path}</div>
                            {r.matches.map((m, i) => (
                              <div key={i} className="pl-3 text-muted-foreground hover:text-white cursor-pointer" onClick={() => openFile(r.path)}>
                                {m.line}: {m.text}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {sidebarTab === "git" && (
                  <div className="p-4 text-sm text-muted-foreground space-y-3 leading-6">
                    <div className="text-foreground font-medium">Source Control</div>
                    <div>Git operations require a backend. This static IDE doesn't have a server git runner — but you can <button className="text-[oklch(0.72_0.18_240)] underline" onClick={() => {
                      const data = JSON.stringify(fs, null, 2);
                      const blob = new Blob([data], { type: "application/json" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a"); a.href = url; a.download = "workspace.json"; a.click();
                    }}>export the workspace</button> as JSON.</div>
                  </div>
                )}
                {sidebarTab === "extensions" && (
                  <div className="p-3 space-y-3 text-sm">
                    <div className="flex gap-1">
                      {(["runtimes", "packages"] as const).map((t) => (
                        <button
                          key={t}
                          onClick={() => setExtTab(t)}
                          className={`flex-1 px-2 py-1.5 rounded-md text-xs uppercase tracking-wide border ${extTab === t ? "bg-[oklch(0.72_0.18_240)]/20 border-[oklch(0.72_0.18_240)]/50 text-foreground" : "border-white/10 text-muted-foreground hover:text-white"}`}
                        >
                          {t === "runtimes" ? "Languages" : "Packages"}
                        </button>
                      ))}
                    </div>

                    {extTab === "runtimes" && (
                      <div className="space-y-3">
                        <div className="text-xs text-muted-foreground">
                          Every language below is available by default at its latest version. Pick another version to switch — it is recorded in <span className="text-foreground">{LIBRARY}/</span>.
                        </div>
                        <input
                          placeholder="Filter languages..."
                          value={extQuery}
                          onChange={(e) => setExtQuery(e.target.value)}
                          className="w-full bg-[oklch(0.1_0.02_260)] border border-white/10 rounded px-2 py-1.5 text-sm outline-none focus:border-[oklch(0.72_0.18_240)]"
                        />
                        {(["Programming", "Web", "Others"] as const).map((group) => {
                          const items = RUNTIMES.filter(
                            (r) => r.group === group && r.name.toLowerCase().includes(extQuery.trim().toLowerCase()),
                          );
                          if (!items.length) return null;
                          return (
                            <div key={group} className="space-y-2">
                              <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{group}</div>
                              {items.map((r) => {
                                const active = installed.runtimes[r.id] || r.version;
                                const list = extVersions[r.id];
                                return (
                                  <div key={r.id} className="glass p-3 rounded-lg space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="text-[15px] text-foreground font-medium truncate">{r.name}</div>
                                        <div className="text-xs text-muted-foreground">v{active}</div>
                                      </div>
                                      <i className="bi bi-check-circle-fill text-[oklch(0.78_0.18_145)] shrink-0" />
                                    </div>
                                    {list ? (
                                      <select
                                        value={active}
                                        onChange={(e) => setRuntimeVersion(r.id, e.target.value)}
                                        className="w-full bg-[oklch(0.1_0.02_260)] border border-white/10 rounded px-2 py-1 text-xs outline-none"
                                      >
                                        {Array.from(new Set([active, ...list])).map((v) => (
                                          <option key={v} value={v}>{v}</option>
                                        ))}
                                      </select>
                                    ) : (
                                      <button
                                        disabled={extBusy}
                                        onClick={() => loadRuntimeVersions(r)}
                                        className="text-xs text-[oklch(0.72_0.18_240)] hover:underline disabled:opacity-50"
                                      >
                                        <i className="bi bi-cloud-arrow-down" /> Find other versions
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {extTab === "packages" && (
                      <div className="space-y-3">
                        <div className="flex gap-1">
                          <input
                            placeholder="Search PyPI / npm..."
                            value={extQuery}
                            onChange={(e) => setExtQuery(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && runExtSearch()}
                            className="flex-1 bg-[oklch(0.1_0.02_260)] border border-white/10 rounded px-2 py-1.5 text-sm outline-none focus:border-[oklch(0.72_0.18_240)]"
                          />
                          <button onClick={runExtSearch} disabled={extBusy} className="px-3 bg-[oklch(0.72_0.18_240)] text-black rounded text-sm disabled:opacity-50">
                            <i className="bi bi-search" />
                          </button>
                        </div>
                        {extBusy && <div className="text-xs text-muted-foreground animate-pulse">Searching the web…</div>}
                        {extHits.map((h) => (
                          <div key={h.registry + h.name} className="glass p-3 rounded-lg space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-[15px] text-foreground font-medium truncate">{h.name}</div>
                                <div className="text-xs text-muted-foreground">{h.registry} · v{h.version}</div>
                              </div>
                              <button onClick={() => installHit(h)} className="text-xs px-2 py-1 rounded bg-[oklch(0.72_0.18_240)]/20 border border-[oklch(0.72_0.18_240)]/40 hover:bg-[oklch(0.72_0.18_240)]/30">
                                Install
                              </button>
                            </div>
                            {h.description && <div className="text-xs text-muted-foreground line-clamp-2">{h.description}</div>}
                          </div>
                        ))}

                        <div className="text-[11px] uppercase tracking-widest text-muted-foreground pt-2">Installed</div>
                        {Object.entries(installed.packages).flatMap(([lang, pkgs]) =>
                          Object.entries(pkgs).map(([name, v]) => (
                            <div key={lang + name} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-white/5">
                              <span className="truncate">{name}<span className="text-muted-foreground"> @{v} · {lang}</span></span>
                              <button title="Uninstall" onClick={() => removePackage(lang, name)} className="text-muted-foreground hover:text-[oklch(0.75_0.2_25)]">
                                <i className="bi bi-trash" />
                              </button>
                            </div>
                          )),
                        )}
                        {!Object.values(installed.packages).some((p) => Object.keys(p).length) && (
                          <div className="text-xs text-muted-foreground">Nothing installed yet — search above, or use <span className="text-foreground">pip install</span> / <span className="text-foreground">npm install</span> in the terminal.</div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {sidebarTab === "ai" && (
                  <div className="flex flex-col h-full p-2">
                    <div className="flex-1 overflow-auto scroll-thin space-y-2 pr-1">
                      {aiChat.length === 0 && (
                        <div className="text-xs text-muted-foreground p-3 space-y-1">
                          <div className="flex items-center gap-1.5 text-[oklch(0.72_0.18_240)]"><i className="bi bi-stars" /> Groq AI ready</div>
                          <div>Try: "explain this code", "fix errors", "add a dark mode toggle"</div>
                        </div>
                      )}
                      {aiChat.map((m, i) => (
                          <div key={i} className={`text-sm p-3 rounded-lg ${m.role === "user" ? "bg-[oklch(0.72_0.18_240)]/20 ml-4" : "bg-white/5 mr-4"}`}>
                          <div className="font-medium mb-1 text-xs uppercase tracking-widest text-muted-foreground">{m.role === "user" ? "You" : "AI"}</div>
                          {m.role === "user"
                            ? <div className="whitespace-pre-wrap text-foreground/90 text-[13.5px] leading-6">{m.text}</div>
                            : <AiMessage text={m.text} />}
                        </div>
                      ))}
                      {aiBusy && <div className="text-xs text-muted-foreground p-2 animate-pulse">Thinking…</div>}
                    </div>
                    <div className="flex gap-1 mt-2">
                      <input
                        value={aiInput}
                        onChange={(e) => setAiInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && sendAi()}
                        disabled={aiBusy}
                        placeholder={aiBusy ? "Waiting..." : "Ask Groq AI..."}
                        className="flex-1 bg-[oklch(0.1_0.02_260)] border border-white/10 rounded px-2 py-2 text-sm outline-none focus:border-[oklch(0.72_0.18_240)] disabled:opacity-60"
                      />
                      <button onClick={sendAi} disabled={aiBusy} className="px-3 bg-[oklch(0.72_0.18_240)] text-black rounded text-sm disabled:opacity-50"><i className="bi bi-send-fill" /></button>
                    </div>
                  </div>
                )}
                {sidebarTab === "debug" && (
                  <div className="p-4 text-sm text-muted-foreground leading-6">
                    <div className="text-foreground font-medium mb-2">Debugger</div>
                    <div>Click ▶ Run to execute the active file. Errors appear in the Problems panel and inline in the editor.</div>
                  </div>
                )}
                {sidebarTab === "settings" && (
                  <div className="p-4 space-y-4 text-sm">
                    <div>
                      <div className="text-foreground mb-1">Theme</div>
                      <select value={settings.theme} onChange={(e) => setSettings(s => ({ ...s, theme: e.target.value as any }))} className="w-full bg-[oklch(0.1_0.02_260)] border border-white/10 rounded px-2 py-1.5">
                        <option value="sam-dark">Sam Dark</option>
                        <option value="vs-dark">VS Dark</option>
                      </select>
                    </div>
                    <div>
                      <div className="text-foreground mb-1">Font size: {settings.fontSize}px</div>
                      <input type="range" min={10} max={24} value={settings.fontSize} onChange={(e) => setSettings(s => ({ ...s, fontSize: +e.target.value }))} className="w-full" />
                    </div>
                    <div>
                      <div className="text-foreground mb-1">Tab size: {settings.tabSize}</div>
                      <input type="range" min={2} max={8} step={2} value={settings.tabSize} onChange={(e) => setSettings(s => ({ ...s, tabSize: +e.target.value }))} className="w-full" />
                    </div>
                    <label className="flex items-center gap-2 text-foreground">
                      <input type="checkbox" checked={settings.wordWrap} onChange={(e) => setSettings(s => ({ ...s, wordWrap: e.target.checked }))} />
                      Word wrap
                    </label>
                    <button onClick={() => { if (confirm("Reset workspace to defaults?")) { setFs({ ...DEFAULT_FS }); setOpenTabs(["index.html"]); setActiveFile("index.html"); }}} className="w-full px-2 py-1.5 bg-destructive/20 text-destructive rounded">Reset workspace</button>
                  </div>
                )}
              </div>
            </div>
          </Panel>

          <PanelResizeHandle className="group w-3 bg-white/5 hover:bg-[oklch(0.72_0.18_240)]/60 active:bg-[oklch(0.72_0.18_240)] transition-colors cursor-col-resize flex items-center justify-center">
            <div className="h-12 w-1 rounded-full bg-white/25 group-hover:bg-white/70" />
          </PanelResizeHandle>

          {/* Editor + bottom */}
          <Panel defaultSize={webcamOn ? "53%" : "78%"} minSize="420px">
            <PanelGroup orientation="vertical" resizeTargetMinimumSize={{ fine: 22, coarse: 34 }}>
              <Panel defaultSize={bottomExpanded ? "68%" : "92%"} minSize="260px">
                <div className="h-full flex flex-col">
                  {/* Tabs */}
                  <div className="flex items-end border-b border-white/5 glass-strong overflow-x-auto scroll-thin shrink-0">
                    {openTabs.map((p) => (
                      <div key={p} className={`tab ${activeFile === p ? "active" : ""}`} onClick={() => setActiveFile(p)}>
                        <FileIcon name={basename(p)} />
                        <span>{basename(p)}</span>
                        {dirty.has(p) && <span className="w-1.5 h-1.5 rounded-full bg-white/80" />}
                        <button className="ml-1 opacity-60 hover:opacity-100 hover:text-destructive" onClick={(e) => { e.stopPropagation(); closeTab(p); }}><i className="bi bi-x" /></button>
                      </div>
                    ))}
                    {openTabs.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">No file open</div>}
                  </div>

                  {/* Editor / viewer */}
                  <div className="flex-1 min-h-0 relative">
                    <div ref={editorElRef} className={`absolute inset-0 ${isImg || isVid || isAud || isPdf ? "hidden" : ""}`} />
                    {isImg && dataUrl && (
                      <div className="absolute inset-0 grid place-items-center bg-[oklch(0.1_0.02_260)] overflow-auto">
                        <img src={dataUrl} alt={activeFile!} className="max-w-full max-h-full" />
                      </div>
                    )}
                    {isVid && dataUrl && (
                      <div className="absolute inset-0 grid place-items-center bg-black">
                        <video src={dataUrl} controls className="max-w-full max-h-full" />
                      </div>
                    )}
                    {isAud && dataUrl && (
                      <div className="absolute inset-0 grid place-items-center">
                        <audio src={dataUrl} controls />
                      </div>
                    )}
                    {isPdf && dataUrl && (
                      <iframe src={dataUrl} className="absolute inset-0 w-full h-full bg-white" title="pdf" />
                    )}
                    {!activeFile && (
                      <div className="absolute inset-0 grid place-items-center text-muted-foreground text-sm">
                        <div className="text-center space-y-2">
                          <div className="text-5xl neon-text"><i className="bi bi-code-slash" /></div>
                          <div>Open a file from the explorer to start coding</div>
                          <div className="text-xs">Ctrl+S save · Ctrl+N new file · Ctrl+` terminal</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </Panel>

              <PanelResizeHandle className="group h-3 bg-white/5 hover:bg-[oklch(0.72_0.18_240)]/60 active:bg-[oklch(0.72_0.18_240)] transition-colors cursor-row-resize flex items-center justify-center">
                <div className="w-14 h-1 rounded-full bg-white/25 group-hover:bg-white/70" />
              </PanelResizeHandle>

              <Panel defaultSize={bottomExpanded ? "32%" : "42px"} minSize="42px" maxSize="70%" collapsible>
                <div className="h-full glass-strong flex flex-col">
                  <div className="flex items-center border-b border-white/5 shrink-0">
                    {(["terminal","output","problems","preview","console"] as BottomTab[]).map((t) => (
                      <div
                        key={t}
                        className={`tab ${bottomTab === t && bottomExpanded ? "active" : ""}`}
                        onClick={() => {
                          if (bottomTab === t) setBottomExpanded((x) => !x);
                          else { setBottomTab(t); setBottomExpanded(true); }
                        }}
                      >
                        <i className={`bi bi-${t === "terminal" ? "terminal" : t === "output" ? "card-text" : t === "problems" ? "exclamation-triangle" : t === "preview" ? "window" : "chat-square-text"}`} />
                        <span className="capitalize">{t}</span>
                        {t === "problems" && problems.length > 0 && (
                          <span className="ml-1 text-[10px] px-1.5 rounded-full bg-destructive text-white">{problems.length}</span>
                        )}
                      </div>
                    ))}
                    <div className="ml-auto px-2 flex items-center gap-2">
                      {bottomTab === "preview" && (
                        <>
                          <button className="titlebar-btn !py-0.5" onClick={() => setPreviewDevice("desktop")} title="Desktop"><i className="bi bi-display" /></button>
                          <button className="titlebar-btn !py-0.5" onClick={() => setPreviewDevice("tablet")} title="Tablet"><i className="bi bi-tablet" /></button>
                          <button className="titlebar-btn !py-0.5" onClick={() => setPreviewDevice("mobile")} title="Mobile"><i className="bi bi-phone" /></button>
                          <button title="Open connected preview in new tab" className="titlebar-btn !py-0.5" onClick={() => {
                            if (!previewHtml) return;
                            if (serverUrl && !serverUrl.startsWith("virtual://")) {
                              window.open(serverUrl, "_blank");
                              return;
                            }
                            const w = window.open("", "_blank");
                            if (w) {
                              w.document.open();
                              w.document.write(previewHtml);
                              w.document.close();
                            }
                          }}><i className="bi bi-box-arrow-up-right" /></button>
                        </>
                      )}
                      <button className="titlebar-btn !py-0.5" onClick={() => setBottomExpanded((x) => !x)} title={bottomExpanded ? "Collapse" : "Expand"}>
                        <i className={`bi bi-chevron-${bottomExpanded ? "down" : "up"}`} />
                      </button>
                    </div>
                  </div>
                  {bottomExpanded && (
                    <div className="flex-1 min-h-0 overflow-hidden">
                      <div className={`h-full ${bottomTab === "terminal" ? "" : "hidden"}`}>
                        <div ref={termElRef} className="h-full w-full p-3" />
                      </div>
                      {bottomTab === "output" && (
                        <div className="h-full overflow-auto scroll-thin p-4 font-mono text-sm space-y-1">
                          {outputLog.length === 0 && <div className="text-muted-foreground">No output. Run a file to see results.</div>}
                          {outputLog.map((l, i) => (
                            <div key={i} className={l.level === "error" ? "text-destructive" : l.level === "warn" ? "text-yellow-400" : l.level === "info" ? "text-[oklch(0.72_0.18_240)]" : "text-foreground/90"}>
                              {l.text}
                            </div>
                          ))}
                        </div>
                      )}
                      {bottomTab === "problems" && (
                        <div className="h-full overflow-auto scroll-thin p-3 text-sm">
                          {problems.length === 0 ? (
                            <div className="text-muted-foreground p-2">No problems detected ✨</div>
                          ) : (
                            problems.map((p, i) => (
                              <div key={i} className="flex items-start gap-2 p-2 hover:bg-white/5 rounded cursor-pointer" onClick={() => openFile(p.file)}>
                                <i className={`bi bi-${p.severity === "error" ? "x-circle-fill text-destructive" : "exclamation-triangle-fill text-yellow-400"} mt-0.5`} />
                                <div className="flex-1">
                                  <div className="text-foreground">{p.message}</div>
                                  <div className="text-muted-foreground">{p.file}:{p.line}:{p.col}</div>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                      {bottomTab === "preview" && (
                        <div className="h-full w-full bg-[oklch(0.08_0.02_260)] overflow-auto scroll-thin">
                          {previewHtml ? (
                            <div className="min-h-full w-full flex items-start justify-center p-3">
                              <iframe
                                ref={previewFrameRef}
                                srcDoc={previewHtml}
                                sandbox="allow-scripts allow-modals allow-forms allow-popups allow-same-origin"
                                className="bg-white rounded-lg shadow-2xl transition-all"
                                style={{
                                  width: previewWidth,
                                  height: previewDevice === "mobile" ? 780 : previewDevice === "tablet" ? 1024 : "calc(100vh - 260px)",
                                  minHeight: 400,
                                  maxWidth: "100%",
                                }}
                                title="preview"
                              />
                            </div>
                          ) : (
                            <div className="h-full grid place-items-center text-muted-foreground text-sm">Run an HTML file to see preview here.</div>
                          )}
                        </div>
                      )}
                      {bottomTab === "console" && (
                        <div className="h-full overflow-auto scroll-thin p-4 font-mono text-sm space-y-1">
                          {outputLog.filter(l => l.level !== "info").length === 0 && <div className="text-muted-foreground">Preview console output appears here.</div>}
                          {outputLog.filter(l => l.level !== "info").map((l, i) => (
                            <div key={i} className={l.level === "error" ? "text-destructive" : l.level === "warn" ? "text-yellow-400" : "text-foreground/90"}>
                              <span className="text-muted-foreground mr-2">{l.level}</span>{l.text}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </Panel>
            </PanelGroup>
          </Panel>

          {webcamOn && (
            <>
              <PanelResizeHandle className="group w-3 bg-white/5 hover:bg-[oklch(0.72_0.18_240)]/60 active:bg-[oklch(0.72_0.18_240)] transition-colors cursor-col-resize flex items-center justify-center">
                <div className="h-12 w-1 rounded-full bg-white/25 group-hover:bg-white/70" />
              </PanelResizeHandle>
              <Panel defaultSize="25%" minSize="260px" maxSize="45%">
                <div className="h-full glass flex flex-col">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
                    <div className="text-xs uppercase tracking-widest text-muted-foreground"><i className="bi bi-camera-video-fill mr-1" /> Webcam</div>
                    <div className="flex gap-1">
                      <button title="Open in new tab" className="titlebar-btn !py-0.5" onClick={openWebcamInNewTab}><i className="bi bi-box-arrow-up-right" /></button>
                      <button title="Stop" className="titlebar-btn !py-0.5" onClick={toggleWebcam}><i className="bi bi-stop-fill" /></button>
                    </div>
                  </div>
                  <div className="flex-1 grid place-items-center bg-black overflow-hidden">
                    <video ref={webcamVideoRef} autoPlay playsInline className="max-w-full max-h-full" />
                  </div>
                  <div className="p-2 text-[11px] text-muted-foreground border-t border-white/5">
                    Camera is live. Use in Python via OpenCV (needs backend) or capture frames with JavaScript.
                  </div>
                </div>
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>

      {/* Status bar */}
      <div className="glass-strong h-6 px-3 flex items-center text-[11px] text-muted-foreground border-t border-white/10 shrink-0 gap-3">
        <span className="text-[oklch(0.72_0.18_240)]"><i className="bi bi-circle-fill text-[8px] mr-1" /> Ready</span>
        <span>{activeFile || "No file"}</span>
        <span>{activeExt ? `.${activeExt}` : ""}</span>
        <span className="ml-auto">{problems.length} {problems.length === 1 ? "problem" : "problems"}</span>
        <span>UTF-8</span>
        <span>Sam Cloud IDE v1.0</span>
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div
          className="fixed glass-strong rounded-lg shadow-2xl py-1 z-50 min-w-[180px] border border-white/10"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {ctxMenu.path && fs[ctxMenu.path]?.type === "folder" && (
            <>
              <CtxItem icon="file-earmark-plus" label="New File" onClick={() => { newFile(ctxMenu.path); setCtxMenu(null); }} />
              <CtxItem icon="folder-plus" label="New Folder" onClick={() => { newFolder(ctxMenu.path); setCtxMenu(null); }} />
              <CtxItem icon="upload" label="Upload Here" onClick={() => { const i = document.createElement("input"); i.type = "file"; i.multiple = true; i.onchange = () => uploadFiles(i.files, ctxMenu.path); i.click(); setCtxMenu(null); }} />
              <div className="border-t border-white/5 my-1" />
            </>
          )}
          {!ctxMenu.path && (
            <>
              <CtxItem icon="file-earmark-plus" label="New File" onClick={() => { newFile(""); setCtxMenu(null); }} />
              <CtxItem icon="folder-plus" label="New Folder" onClick={() => { newFolder(""); setCtxMenu(null); }} />
              <CtxItem icon="upload" label="Upload" onClick={() => { fileInputRef.current?.click(); setCtxMenu(null); }} />
            </>
          )}
          {ctxMenu.path && (
            <>
              <CtxItem icon="pencil" label="Rename" onClick={() => { renameAt(ctxMenu.path); setCtxMenu(null); }} />
              <CtxItem icon="files" label="Duplicate" onClick={() => { duplicateAt(ctxMenu.path); setCtxMenu(null); }} />
              <CtxItem icon="download" label="Download" onClick={() => { downloadFile(ctxMenu.path); setCtxMenu(null); }} />
              <div className="border-t border-white/5 my-1" />
              <CtxItem icon="trash" label="Delete" danger onClick={() => { deleteAt(ctxMenu.path); setCtxMenu(null); }} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CtxItem({ icon, label, onClick, danger }: { icon: string; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-white/10 ${danger ? "text-destructive" : "text-foreground"}`}
    >
      <i className={`bi bi-${icon} w-4`} /> {label}
    </button>
  );
}

function FileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, { icon: string; color: string }> = {
    html: { icon: "filetype-html", color: "#e34c26" },
    css: { icon: "filetype-css", color: "#1572b6" },
    js: { icon: "filetype-js", color: "#f7df1e" },
    ts: { icon: "filetype-tsx", color: "#3178c6" },
    tsx: { icon: "filetype-tsx", color: "#3178c6" },
    jsx: { icon: "filetype-jsx", color: "#61dafb" },
    py: { icon: "filetype-py", color: "#3776ab" },
    json: { icon: "filetype-json", color: "#cbcb41" },
    md: { icon: "filetype-md", color: "#519aba" },
    png: { icon: "filetype-png", color: "#a074c4" },
    jpg: { icon: "filetype-jpg", color: "#a074c4" },
    jpeg: { icon: "filetype-jpg", color: "#a074c4" },
    gif: { icon: "filetype-gif", color: "#a074c4" },
    svg: { icon: "filetype-svg", color: "#ffb13b" },
    mp4: { icon: "filetype-mp4", color: "#f06292" },
    mp3: { icon: "filetype-mp3", color: "#26a69a" },
    pdf: { icon: "filetype-pdf", color: "#e53935" },
    sql: { icon: "filetype-sql", color: "#f06292" },
    java: { icon: "filetype-java", color: "#ea2d2e" },
    php: { icon: "filetype-php", color: "#777bb4" },
  };
  const m = map[ext] || { icon: "file-earmark", color: "#9aa5c7" };
  return <i className={`bi bi-${m.icon}`} style={{ color: m.color, fontSize: 14 }} />;
}
