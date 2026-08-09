/**
 * A tiny in-browser Node.js runtime.
 *
 * It gives `node server.js` a real CommonJS module system (relative requires,
 * package.json main, index.js), Node core-module shims, and working shims for
 * the packages small servers actually use: express, socket.io, multer, cors,
 * body-parser, dotenv, uuid/nanoid, axios and @ngrok/ngrok.
 *
 * When the program calls `app.listen(port)` we register a *virtual server*:
 * the Preview iframe talks to it over postMessage, so fetch/XHR/socket.io from
 * the served page hit the very same handlers the real Node app defines.
 */
import { dirname, normalize, type FSMap } from "./fs";

/* ------------------------------------------------------------------ utils */

const te = new TextEncoder();
const td = new TextDecoder();

function b64encode(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64decode(s: string) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const MIME: Record<string, string> = {
  html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript", mjs: "text/javascript",
  json: "application/json", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  svg: "image/svg+xml", webp: "image/webp", ico: "image/x-icon", mp4: "video/mp4", webm: "video/webm",
  mp3: "audio/mpeg", wav: "audio/wav", txt: "text/plain", pdf: "application/pdf", woff2: "font/woff2",
};
const mimeOf = (p: string) => MIME[p.split(".").pop()!.toLowerCase()] || "application/octet-stream";

/* ---------------------------------------------------------------- types */

export type VReq = { method: string; url: string; headers: Record<string, string>; body?: string; isBase64?: boolean };
export type VRes = { status: number; headers: Record<string, string>; body: string; isBase64?: boolean };

export type SocketHub = {
  connect(sid: string, send: (event: string, args: any[]) => void): void;
  disconnect(sid: string): void;
  receive(sid: string, event: string, args: any[]): void;
};

export type VirtualServer = {
  port: number;
  root: string;
  staticDirs: string[];
  handle(req: VReq): Promise<VRes>;
  hub: SocketHub;
  close(): void;
};

type IoHooks = { write: (s: string) => void; error: (s: string) => void };

/* --------------------------------------------------------- socket.io hub */

type ServerSocket = {
  id: string;
  rooms: Set<string>;
  handlers: Map<string, Function[]>;
  send: (event: string, args: any[]) => void;
};

function createSocketLayer() {
  const sockets = new Map<string, ServerSocket>();
  const connectionHandlers: Function[] = [];
  const serverHandlers = new Map<string, Function[]>();

  const emitTo = (ids: Iterable<string>, event: string, args: any[]) => {
    for (const id of ids) sockets.get(id)?.send(event, args);
  };
  const inRoom = (room: string) => [...sockets.values()].filter((s) => s.rooms.has(room)).map((s) => s.id);

  const io: any = {
    on(event: string, cb: Function) {
      if (event === "connection" || event === "connect") connectionHandlers.push(cb);
      else serverHandlers.set(event, [...(serverHandlers.get(event) || []), cb]);
      return io;
    },
    once(event: string, cb: Function) { return io.on(event, cb); },
    emit(event: string, ...args: any[]) { emitTo(sockets.keys(), event, args); return true; },
    to(room: string) { return roomScope([room]); },
    in(room: string) { return roomScope([room]); },
    of() { return io; },
    use() { return io; },
    close() { sockets.clear(); },
    get sockets() { return { emit: io.emit, sockets, adapter: { rooms: new Map() } }; },
    engine: { clientsCount: 0 },
    attach() { return io; }, listen() { return io; },
  };
  const roomScope = (rooms: string[]) => ({
    emit(event: string, ...args: any[]) { emitTo(new Set(rooms.flatMap(inRoom)), event, args); return true; },
    to(room: string) { return roomScope([...rooms, room]); },
  });

  const hub: SocketHub = {
    connect(sid, send) {
      const sock: any = {
        id: sid,
        rooms: new Set<string>([sid]),
        handlers: new Map<string, Function[]>(),
        send,
        connected: true,
        handshake: { address: "127.0.0.1", headers: {}, query: {}, time: new Date().toISOString() },
        on(event: string, cb: Function) { sock.handlers.set(event, [...(sock.handlers.get(event) || []), cb]); return sock; },
        once(event: string, cb: Function) { return sock.on(event, cb); },
        off(event: string) { sock.handlers.delete(event); return sock; },
        emit(event: string, ...args: any[]) { send(event, args); return true; },
        join(room: string) { sock.rooms.add(room); return sock; },
        leave(room: string) { sock.rooms.delete(room); return sock; },
        to(room: string) { return roomScope([room]); },
        in(room: string) { return roomScope([room]); },
        get broadcast() {
          return {
            emit(event: string, ...args: any[]) {
              emitTo([...sockets.keys()].filter((k) => k !== sid), event, args);
              return true;
            },
            to(room: string) { return roomScope([room]); },
          };
        },
        disconnect() { hub.disconnect(sid); return sock; },
      };
      sockets.set(sid, sock);
      io.engine.clientsCount = sockets.size;
      connectionHandlers.forEach((cb) => { try { cb(sock); } catch (e) { console.error(e); } });
    },
    disconnect(sid) {
      const sock = sockets.get(sid);
      if (!sock) return;
      sockets.delete(sid);
      io.engine.clientsCount = sockets.size;
      (sock.handlers.get("disconnect") || []).forEach((cb) => { try { cb("transport close"); } catch { /* noop */ } });
    },
    receive(sid, event, args) {
      const sock = sockets.get(sid);
      if (!sock) return;
      const cbs = sock.handlers.get(event) || [];
      cbs.forEach((cb) => { try { cb(...args); } catch (e) { console.error(e); } });
      (sock.handlers.get("*") || []).forEach((cb) => { try { cb(event, ...args); } catch { /* noop */ } });
    },
  };

  return { io, hub };
}

/* -------------------------------------------------------------- express */

type Layer = { method: string; path: string | null; handler: Function; isStatic?: string };

function createExpressApp(vfs: VFS, io: IoHooks) {
  const layers: Layer[] = [];
  const settings: Record<string, any> = {};
  const staticDirs: string[] = [];

  const add = (method: string, path: any, handlers: any[]) => {
    for (const h of handlers.flat()) {
      if (typeof h === "function") layers.push({ method, path: typeof path === "string" ? path : null, handler: h, isStatic: (h as any).__staticDir });
      else if (h && typeof h.__handle === "function") layers.push({ method, path: typeof path === "string" ? path : null, handler: h.__handle });
    }
  };

  const app: any = (req: any, res: any) => app.__handle(req, res);
  app.__layers = layers;
  app.__staticDirs = staticDirs;
  for (const m of ["get", "post", "put", "delete", "patch", "options", "head", "all"]) {
    app[m] = (path: any, ...h: any[]) => {
      if (m === "get" && typeof path === "string" && h.length === 0) return settings[path];
      add(m.toUpperCase(), path, h);
      return app;
    };
  }
  app.use = (path: any, ...h: any[]) => {
    if (typeof path === "function" || (path && path.__handle)) { add("USE", null, [path, ...h]); return app; }
    add("USE", path, h);
    return app;
  };
  app.set = (k: string, v: any) => { settings[k] = v; return app; };
  app.engine = () => app;
  app.locals = {};
  app.listen = (...a: any[]) => {
    const port = typeof a[0] === "number" ? a[0] : parseInt(String(a[0] ?? 3000), 10) || 3000;
    const cb = a.find((x) => typeof x === "function");
    const srv = registerServer(port, app, vfs, io, staticDirs);
    if (cb) setTimeout(() => { try { cb(); } catch (e) { io.error(String((e as any)?.message || e)); } }, 0);
    return srv.nodeServer;
  };
  return app;
}

function matchPath(pattern: string | null, url: string, exact: boolean) {
  const path = url.split("?")[0].replace(/\/+$/, "") || "/";
  if (!pattern) return { ok: true, params: {} as Record<string, string> };
  const pat = pattern.replace(/\/+$/, "") || "/";
  if (!exact) {
    if (pat === "/") return { ok: true, params: {} };
    return path === pat || path.startsWith(pat + "/") ? { ok: true, params: {} } : { ok: false, params: {} };
  }
  const pp = pat.split("/"); const up = path.split("/");
  if (pat.includes("*")) {
    const rx = new RegExp("^" + pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
    return { ok: rx.test(path), params: {} };
  }
  if (pp.length !== up.length) return { ok: false, params: {} };
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(":")) params[pp[i].slice(1)] = decodeURIComponent(up[i]);
    else if (pp[i] !== up[i]) return { ok: false, params: {} };
  }
  return { ok: true, params };
}

/* ------------------------------------------------------------ virtual FS */

type VFS = {
  fs: FSMap;
  root: string;
  overlay: Map<string, { text?: string; bytes?: Uint8Array }>;
  read(path: string): { text?: string; bytes?: Uint8Array } | null;
  exists(path: string): boolean;
  write(path: string, data: string | Uint8Array): void;
  list(path: string): string[];
};

function createVfs(fs: FSMap, root: string): VFS {
  const overlay = new Map<string, { text?: string; bytes?: Uint8Array }>();
  const abs = (p: string) => normalize(String(p).replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, ""));
  return {
    fs, root, overlay,
    read(p) {
      const path = abs(p);
      if (overlay.has(path)) return overlay.get(path)!;
      const n = fs[path];
      if (!n || n.type !== "file") return null;
      return n.binary ? { bytes: b64decode(n.content) } : { text: n.content };
    },
    exists(p) { const path = abs(p); return overlay.has(path) || !!fs[path]; },
    write(p, data) {
      const path = abs(p);
      overlay.set(path, typeof data === "string" ? { text: data } : { bytes: data });
    },
    list(p) {
      const path = abs(p);
      const prefix = path ? path + "/" : "";
      const names = new Set<string>();
      for (const k of [...Object.keys(fs), ...overlay.keys()]) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        if (rest) names.add(rest.split("/")[0]);
      }
      return [...names];
    },
  };
}

/* -------------------------------------------------------- server registry */

const servers = new Map<number, VirtualServer>();
export function getServer(port?: number): VirtualServer | undefined {
  if (port != null) return servers.get(port);
  return [...servers.values()].pop();
}
export function stopAllServers() { servers.forEach((s) => s.close()); servers.clear(); }

function registerServer(port: number, app: any, vfs: VFS, io: IoHooks, staticDirs: string[]) {
  const { io: sio, hub } = (app.__socket ||= createSocketLayer());
  void sio;
  const server: VirtualServer = {
    port,
    root: vfs.root,
    staticDirs,
    hub,
    close() { servers.delete(port); },
    async handle(req) { return handleRequest(app, vfs, req); },
  };
  servers.set(port, server);
  (server as any).nodeServer = app.__nodeServer || app;
  io.write(`\x1b[32m  Server listening on http://localhost:${port}\x1b[0m\n`);
  return server as VirtualServer & { nodeServer: any };
}

/* ------------------------------------------------------- request pipeline */

async function handleRequest(app: any, vfs: VFS, vreq: VReq): Promise<VRes> {
  const url = vreq.url.startsWith("http") ? new URL(vreq.url).pathname + new URL(vreq.url).search : vreq.url;
  const [pathname, search = ""] = url.split("?");
  const query: Record<string, string> = {};
  new URLSearchParams(search).forEach((v, k) => { query[k] = v; });

  const rawBody = vreq.isBase64 && vreq.body ? b64decode(vreq.body) : undefined;
  const textBody = rawBody ? td.decode(rawBody) : vreq.body || "";
  const ct = (vreq.headers["content-type"] || vreq.headers["Content-Type"] || "").toLowerCase();
  let parsed: any = undefined;
  if (ct.includes("application/json")) { try { parsed = JSON.parse(textBody || "{}"); } catch { parsed = {}; } }
  else if (ct.includes("application/x-www-form-urlencoded")) {
    parsed = {}; new URLSearchParams(textBody).forEach((v, k) => { parsed[k] = v; });
  }

  const req: any = {
    method: (vreq.method || "GET").toUpperCase(),
    url, originalUrl: url, path: pathname, baseUrl: "",
    query, params: {}, headers: vreq.headers || {},
    body: parsed, rawBody, rawText: textBody,
    ip: "127.0.0.1", protocol: "http", secure: false,
    cookies: {}, files: [], file: undefined,
    get(h: string) { return (vreq.headers || {})[h.toLowerCase()]; },
    is(t: string) { return ct.includes(t); },
    socket: { remoteAddress: "127.0.0.1" },
  };

  return new Promise<VRes>((resolve) => {
    let finished = false;
    const out: VRes = { status: 200, headers: {}, body: "" };
    const finish = () => { if (!finished) { finished = true; resolve(out); } };

    const res: any = {
      statusCode: 200,
      headersSent: false,
      status(c: number) { res.statusCode = c; return res; },
      sendStatus(c: number) { res.statusCode = c; return res.send(String(c)); },
      set(k: any, v?: string) {
        if (typeof k === "object") Object.assign(out.headers, k);
        else out.headers[k] = String(v);
        return res;
      },
      header(k: any, v?: string) { return res.set(k, v); },
      setHeader(k: string, v: string) { return res.set(k, v); },
      getHeader(k: string) { return out.headers[k]; },
      type(t: string) { out.headers["content-type"] = t.includes("/") ? t : (MIME[t] || t); return res; },
      cookie() { return res; },
      json(obj: any) {
        out.headers["content-type"] = "application/json";
        out.body = JSON.stringify(obj ?? null);
        out.status = res.statusCode;
        finish(); return res;
      },
      send(data: any) {
        if (data instanceof Uint8Array) { out.body = b64encode(data); out.isBase64 = true; }
        else if (typeof data === "object" && data !== null) return res.json(data);
        else {
          out.body = String(data ?? "");
          if (!out.headers["content-type"]) out.headers["content-type"] = /^\s*</.test(out.body) ? "text/html" : "text/plain";
        }
        out.status = res.statusCode;
        finish(); return res;
      },
      write(chunk: any) { out.body += String(chunk); return true; },
      end(data?: any) {
        if (data != null) out.body += typeof data === "string" ? data : "";
        out.status = res.statusCode;
        finish(); return res;
      },
      redirect(a: any, b?: any) {
        out.status = typeof a === "number" ? a : 302;
        out.headers["location"] = typeof a === "number" ? b : a;
        finish(); return res;
      },
      sendFile(p: string) {
        const rel = String(p).replace(/\\/g, "/");
        const candidates = [rel, `${vfs.root}/${rel.replace(/^.*?\/(?=[^/]*$)/, "")}`, `${vfs.root}/${rel}`];
        for (const c of candidates) {
          const f = vfs.read(c);
          if (f) {
            out.headers["content-type"] = mimeOf(c);
            out.headers["x-sam-vfs-path"] = c;
            if (f.bytes) { out.body = b64encode(f.bytes); out.isBase64 = true; }
            else out.body = f.text || "";
            out.status = res.statusCode;
            return finish();
          }
        }
        out.status = 404; out.body = `Cannot find ${p}`; finish();
      },
      download(p: string) { return res.sendFile(p); },
      render(view: string) { return res.send(`<!doctype html><p>render(${view}) is not supported in the browser sandbox.</p>`); },
    };

    const layers: Layer[] = app.__layers || [];
    let i = 0;
    const next = (err?: any) => {
      if (finished) return;
      if (err) { out.status = 500; out.body = String(err?.message || err); return finish(); }
      const layer = layers[i++];
      if (!layer) {
        // static fallback then 404
        const served = tryStatic(app, vfs, pathname, out);
        if (served) return finish();
        out.status = 404; out.body = `Cannot ${req.method} ${pathname}`;
        return finish();
      }
      if (layer.method !== "USE" && layer.method !== "ALL" && layer.method !== req.method) return next();
      const m = matchPath(layer.path, pathname, layer.method !== "USE");
      if (!m.ok) return next();
      req.params = m.params;
      try {
        const r = layer.handler.length >= 4 ? layer.handler(null, req, res, next) : layer.handler(req, res, next);
        if (r && typeof r.then === "function") r.catch((e: any) => next(e));
      } catch (e) { next(e); }
    };
    next();
  });
}

function tryStatic(app: any, vfs: VFS, pathname: string, out: VRes) {
  const rel = decodeURIComponent(pathname.replace(/^\//, "")) || "index.html";
  const dirs: string[] = [...(app.__staticDirs || []), vfs.root, `${vfs.root}/public`, `${vfs.root}/static`];
  for (const d of dirs) {
    for (const cand of [d ? `${d}/${rel}` : rel, d ? `${d}/${rel}/index.html` : `${rel}/index.html`]) {
      const f = vfs.read(cand);
      if (f) {
        out.headers["content-type"] = mimeOf(cand);
        out.headers["x-sam-vfs-path"] = cand;
        if (f.bytes) { out.body = b64encode(f.bytes); out.isBase64 = true; }
        else out.body = f.text || "";
        out.status = 200;
        return true;
      }
    }
  }
  return false;
}

/* ------------------------------------------------------------- multipart */

function parseMultipart(bytes: Uint8Array, boundary: string) {
  const parts: { name: string; filename?: string; type?: string; data: Uint8Array }[] = [];
  const sep = te.encode(`--${boundary}`);
  const idxs: number[] = [];
  outer: for (let i = 0; i <= bytes.length - sep.length; i++) {
    for (let j = 0; j < sep.length; j++) if (bytes[i + j] !== sep[j]) continue outer;
    idxs.push(i);
  }
  for (let k = 0; k < idxs.length - 1; k++) {
    const start = idxs[k] + sep.length + 2;
    const end = idxs[k + 1] - 2;
    if (end <= start) continue;
    const chunk = bytes.subarray(start, end);
    const headEnd = td.decode(chunk.subarray(0, Math.min(chunk.length, 1024))).indexOf("\r\n\r\n");
    if (headEnd < 0) continue;
    const head = td.decode(chunk.subarray(0, headEnd));
    const data = chunk.subarray(headEnd + 4);
    const name = /name="([^"]*)"/.exec(head)?.[1] || "";
    const filename = /filename="([^"]*)"/.exec(head)?.[1];
    const type = /Content-Type:\s*([^\r\n]+)/i.exec(head)?.[1];
    parts.push({ name, filename, type, data });
  }
  return parts;
}

/* ---------------------------------------------------------- core modules */

class EventEmitter {
  private _e = new Map<string, Function[]>();
  on(k: string, f: Function) { this._e.set(k, [...(this._e.get(k) || []), f]); return this; }
  once(k: string, f: Function) { return this.on(k, f); }
  off(k: string) { this._e.delete(k); return this; }
  removeListener(k: string) { return this.off(k); }
  emit(k: string, ...a: any[]) { (this._e.get(k) || []).forEach((f) => f(...a)); return true; }
  listeners(k: string) { return this._e.get(k) || []; }
}

function buildCoreModules(vfs: VFS, io: IoHooks) {
  const resolvePath = (...parts: string[]) => {
    const stack: string[] = [];
    const joined = parts.filter(Boolean).join("/").replace(/\\/g, "/");
    for (const part of joined.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    const resolved = stack.join("/");
    if (!resolved) return vfs.root;
    if (resolved === vfs.root || resolved.startsWith(vfs.root + "/")) return resolved;
    return normalize(`${vfs.root}/${resolved}`);
  };
  const pathMod = {
    sep: "/",
    join: (...p: string[]) => normalize(p.filter(Boolean).join("/").replace(/\\/g, "/")),
    resolve: (...p: string[]) => resolvePath(...p),
    dirname: (p: string) => dirname(p.replace(/\\/g, "/")),
    basename: (p: string, ext?: string) => { const b = p.replace(/\\/g, "/").split("/").pop() || ""; return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; },
    extname: (p: string) => { const b = p.split("/").pop() || ""; const i = b.lastIndexOf("."); return i > 0 ? b.slice(i) : ""; },
    normalize: (p: string) => normalize(p.replace(/\\/g, "/")),
    relative: (from: string, to: string) => to.replace(from.replace(/\/?$/, "/"), ""),
    isAbsolute: (p: string) => p.startsWith("/"),
    parse: (p: string) => ({ root: "", dir: dirname(p), base: p.split("/").pop() || "", ext: "", name: "" }),
  };

  const fsMod: any = {
    existsSync: (p: string) => vfs.exists(p),
    readFileSync: (p: string, enc?: any) => {
      const f = vfs.read(p);
      if (!f) { const e: any = new Error(`ENOENT: no such file or directory, open '${p}'`); e.code = "ENOENT"; throw e; }
      const text = f.text ?? td.decode(f.bytes!);
      return enc ? text : bufferFrom(text);
    },
    writeFileSync: (p: string, data: any) => vfs.write(p, typeof data === "string" ? data : data),
    appendFileSync: (p: string, data: any) => {
      const cur = vfs.read(p)?.text || "";
      vfs.write(p, cur + String(data));
    },
    mkdirSync: () => undefined,
    readdirSync: (p: string) => vfs.list(p),
    statSync: (p: string) => ({ isDirectory: () => !vfs.read(p) && vfs.exists(p), isFile: () => !!vfs.read(p), size: (vfs.read(p)?.text || "").length, mtime: new Date() }),
    unlinkSync: () => undefined,
    createWriteStream: () => ({ write: () => true, end: () => undefined, on: () => undefined }),
    createReadStream: () => ({ pipe: () => undefined, on: () => undefined }),
    promises: {
      readFile: async (p: string, enc?: any) => fsMod.readFileSync(p, enc),
      writeFile: async (p: string, d: any) => fsMod.writeFileSync(p, d),
      mkdir: async () => undefined,
      readdir: async (p: string) => vfs.list(p),
    },
  };

  const httpMod = {
    createServer: (handler?: any) => {
      const srv: any = new EventEmitter();
      srv.__app = handler;
      srv.listen = (...a: any[]) => {
        const port = typeof a[0] === "number" ? a[0] : parseInt(String(a[0] ?? 3000), 10) || 3000;
        const cb = a.find((x: any) => typeof x === "function");
        const app = handler && handler.__layers ? handler : handler;
        (app as any).__nodeServer = srv;
        registerServer(port, app, vfs, io, (app as any).__staticDirs || []);
        if (cb) setTimeout(() => cb(), 0);
        return srv;
      };
      srv.address = () => ({ port: 0, address: "127.0.0.1" });
      srv.close = (cb?: any) => { stopAllServers(); cb?.(); };
      return srv;
    },
    STATUS_CODES: {} as Record<string, string>,
  };

  const osMod = {
    platform: () => "browser",
    type: () => "Browser",
    hostname: () => "sam-cloud-ide",
    tmpdir: () => "/tmp",
    homedir: () => "/home/user",
    arch: () => "wasm32",
    cpus: () => [{ model: "wasm", speed: 0 }],
    totalmem: () => 0, freemem: () => 0,
    networkInterfaces: () => ({ "Wi-Fi": [{ family: "IPv4", internal: false, address: "127.0.0.1" }] }),
  };

  const cryptoMod = {
    randomUUID: () => crypto.randomUUID(),
    randomBytes: (n: number) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return { toString: (enc = "hex") => enc === "hex" ? [...a].map((x) => x.toString(16).padStart(2, "0")).join("") : b64encode(a), length: n }; },
    createHash: () => ({ update() { return this; }, digest: () => Math.random().toString(16).slice(2) }),
  };

  return { pathMod, fsMod, httpMod, osMod, cryptoMod };
}

function bufferFrom(input: any, enc?: string): any {
  const bytes = typeof input === "string"
    ? (enc === "base64" ? b64decode(input) : te.encode(input))
    : input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  const buf: any = bytes;
  (buf as any).toString = (e = "utf8") => (e === "base64" ? b64encode(bytes) : e === "hex" ? [...bytes].map((x) => x.toString(16).padStart(2, "0")).join("") : td.decode(bytes));
  return buf;
}
const BufferShim: any = {
  from: (i: any, e?: string) => bufferFrom(i, e),
  alloc: (n: number) => bufferFrom(new Uint8Array(n)),
  concat: (list: Uint8Array[]) => {
    const total = list.reduce((s, b) => s + b.length, 0);
    const out = new Uint8Array(total);
    let o = 0; for (const b of list) { out.set(b, o); o += b.length; }
    return bufferFrom(out);
  },
  isBuffer: (b: any) => b instanceof Uint8Array,
};

/* ------------------------------------------------------ package registry */

function buildPackages(vfs: VFS, io: IoHooks) {
  const socketLayers = new WeakMap<any, any>();

  const expressFactory: any = () => createExpressApp(vfs, io);
  expressFactory.json = () => (req: any, _res: any, next: Function) => {
    if (req.body === undefined && req.rawText) { try { req.body = JSON.parse(req.rawText); } catch { req.body = {}; } }
    req.body ||= {};
    next();
  };
  expressFactory.urlencoded = () => (req: any, _res: any, next: Function) => {
    if (req.body === undefined && req.rawText) {
      const o: any = {}; new URLSearchParams(req.rawText).forEach((v, k) => { o[k] = v; });
      req.body = o;
    }
    req.body ||= {};
    next();
  };
  expressFactory.text = expressFactory.raw = () => (req: any, _res: any, next: Function) => { req.body = req.rawText; next(); };
  expressFactory.static = (dir: string) => {
    const abs = normalize(String(dir).replace(/\\/g, "/").replace(/^\.\//, "")) || vfs.root;
    const resolved = abs === vfs.root || abs.startsWith(vfs.root + "/")
      ? abs
      : `${vfs.root}/${abs}`.replace(/\/+/g, "/");
    const mw: any = (req: any, res: any, next: Function) => {
      const out: VRes = { status: 200, headers: {}, body: "" };
      const rel = decodeURIComponent(req.path.replace(/^\//, "")) || "index.html";
      for (const cand of [`${resolved}/${rel}`, `${resolved}/${rel}/index.html`]) {
        const f = vfs.read(cand);
        if (f) {
          res.set("content-type", mimeOf(cand));
          res.set("x-sam-vfs-path", cand);
          return f.bytes ? res.send(f.bytes) : res.send(f.text || "");
        }
      }
      void out; next();
    };
    mw.__staticDir = resolved;
    return mw;
  };
  expressFactory.Router = () => {
    const r: any = createExpressApp(vfs, io);
    r.__handle = (req: any, res: any, next: Function) => { void req; void res; next(); };
    return r;
  };

  const socketIo: any = function (server?: any) { return socketIoServer(server); };
  function socketIoServer(server?: any) {
    const app = server?.__app || server || {};
    const layer = (app.__socket ||= createSocketLayer());
    socketLayers.set(app, layer);
    return layer.io;
  }
  socketIo.Server = function (server?: any) { return socketIoServer(server); };

  const multer: any = (opts: any = {}) => {
    const dest = opts.dest || (opts.storage && opts.storage.__dest) || "uploads";
    const handle = (fields: string[] | null) => (req: any, _res: any, next: Function) => {
      const ct = req.headers["content-type"] || "";
      const boundary = /boundary=([^;]+)/.exec(ct)?.[1];
      if (!boundary || !req.rawBody) { req.body ||= {}; return next(); }
      const parts = parseMultipart(req.rawBody, boundary.replace(/^"|"$/g, ""));
      req.body ||= {};
      req.files = [];
      for (const p of parts) {
        if (p.filename) {
          const filename = `${Date.now()}-${p.filename}`;
          const stored = `${vfs.root}/${dest}/${filename}`.replace(/\/+/g, "/");
          vfs.write(stored, p.data);
          const file = { fieldname: p.name, originalname: p.filename, mimetype: p.type || "application/octet-stream", filename, path: stored, size: p.data.length, destination: dest };
          req.files.push(file);
          if (!req.file) req.file = file;
        } else req.body[p.name] = td.decode(p.data);
      }
      if (fields && fields.length) req.file = req.files.find((f: any) => fields.includes(f.fieldname)) || req.files[0];
      next();
    };
    return {
      single: (name: string) => handle([name]),
      array: (name: string) => handle([name]),
      fields: () => handle(null),
      any: () => handle(null),
      none: () => handle(null),
    };
  };
  multer.diskStorage = (o: any) => ({ __dest: typeof o?.destination === "string" ? o.destination : "uploads" });
  multer.memoryStorage = () => ({ __dest: "uploads" });

  const ngrok: any = {
    connect: async (o: any) => {
      const port = typeof o === "number" ? o : o?.addr || o?.port || 3000;
      const url = `https://${Math.random().toString(36).slice(2, 8)}-sandbox.ngrok.local`;
      io.write(`\x1b[32m  Public URL ready:\x1b[0m \x1b[36m${url}\x1b[0m\n`);
      io.write(`  \x1b[33m(sandbox tunnel — it maps to the virtual server on port ${port}; open it from the Preview tab)\x1b[0m\n`);
      return { url: () => url, toString: () => url, addr: port };
    },
    forward: async (o: any) => ngrok.connect(o),
    authtoken: async () => undefined,
    setAuthtoken: async () => undefined,
    disconnect: async () => undefined,
    kill: async () => undefined,
    getUrl: () => undefined,
    default: undefined as any,
  };
  ngrok.default = ngrok;

  const cors = () => (_req: any, _res: any, next: Function) => next();
  const bodyParser = { json: expressFactory.json, urlencoded: expressFactory.urlencoded, text: expressFactory.text, raw: expressFactory.raw };
  const dotenv = { config: () => ({ parsed: {} }) };
  const uuid = { v4: () => crypto.randomUUID(), v1: () => crypto.randomUUID() };
  const nanoid = { nanoid: (n = 21) => Array.from(crypto.getRandomValues(new Uint8Array(n))).map((x) => "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict"[x % 64]).join("") };
  const axios: any = async (cfg: any) => {
    const r = await fetch(typeof cfg === "string" ? cfg : cfg.url, { method: cfg.method || "GET", headers: cfg.headers, body: cfg.data ? JSON.stringify(cfg.data) : undefined });
    const text = await r.text();
    try { return { status: r.status, data: JSON.parse(text) }; } catch { return { status: r.status, data: text }; }
  };
  axios.get = (u: string, c: any = {}) => axios({ ...c, url: u, method: "GET" });
  axios.post = (u: string, d: any, c: any = {}) => axios({ ...c, url: u, method: "POST", data: d });

  return { expressFactory, socketIo, multer, ngrok, cors, bodyParser, dotenv, uuid, nanoid, axios };
}

/* ------------------------------------------------------- module resolver */

export async function runNodeFile(fs: FSMap, root: string, entry: string, io: IoHooks): Promise<VirtualServer | null> {
  const vfs = createVfs(fs, root);
  const core = buildCoreModules(vfs, io);
  const pkgs = buildPackages(vfs, io);
  const cache = new Map<string, any>();

  // One shared process.env for every module in the run, pre-loaded from .env
  // files so API-key based projects work without extra setup.
  const SANDBOX_NGROK_TOKEN = "sam_sandbox_ngrok_token";
  const sharedEnv: Record<string, string> = {
    NODE_ENV: "development",
    NGROK_AUTHTOKEN: SANDBOX_NGROK_TOKEN,
    NGROK_AUTH_TOKEN: SANDBOX_NGROK_TOKEN,
  };
  const parseEnvFile = (text: string) => {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
      let value = line.slice(eq + 1).trim();
      if (/^(".*"|'.*')$/s.test(value)) value = value.slice(1, -1);
      sharedEnv[key] = value;
    }
  };
  for (const name of [".env", ".env.local", ".env.development"]) {
    const f = vfs.read(`${root}/${name}`.replace(/\/+/g, "/"));
    if (f?.text) parseEnvFile(f.text);
  }
  pkgs.dotenv.config = (opts: any = {}) => {
    const p = opts.path ? String(opts.path) : `${root}/.env`.replace(/\/+/g, "/");
    const f = vfs.read(p);
    if (f?.text) parseEnvFile(f.text);
    return { parsed: { ...sharedEnv } };
  };


  const consoleShim = {
    log: (...a: any[]) => io.write(fmt(a) + "\n"),
    info: (...a: any[]) => io.write(fmt(a) + "\n"),
    warn: (...a: any[]) => io.write(`\x1b[33m${fmt(a)}\x1b[0m\n`),
    error: (...a: any[]) => io.error(fmt(a)),
    debug: (...a: any[]) => io.write(fmt(a) + "\n"),
    table: (a: any) => io.write(fmt([a]) + "\n"),
    clear: () => undefined,
  };
  const fmt = (a: any[]) => a.map((x) => (typeof x === "string" ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })())).join(" ");

  const resolveModule = (spec: string, fromDir: string): string | null => {
    if (!/^\.{0,2}\//.test(spec)) return null;
    const base = spec.startsWith("/") ? root : fromDir;
    const joined = normalize(`${base}/${spec.replace(/^\//, "")}`);
    for (const c of [joined, `${joined}.js`, `${joined}.cjs`, `${joined}.mjs`, `${joined}.json`, `${joined}/index.js`, `${joined}/index.json`]) {
      const n = fs[c];
      if (n && n.type === "file") return c;
      if (n && n.type === "folder") {
        const pj = fs[`${c}/package.json`];
        if (pj && pj.type === "file") {
          try {
            const main = JSON.parse(pj.content).main || "index.js";
            const mp = normalize(`${c}/${main}`);
            if (fs[mp]) return mp;
          } catch { /* ignore */ }
        }
      }
    }
    return null;
  };

  const builtins: Record<string, any> = {
    path: core.pathMod, "node:path": core.pathMod,
    fs: core.fsMod, "node:fs": core.fsMod, "fs/promises": core.fsMod.promises,
    http: core.httpMod, "node:http": core.httpMod, https: core.httpMod,
    os: core.osMod, "node:os": core.osMod,
    crypto: core.cryptoMod, "node:crypto": core.cryptoMod,
    events: Object.assign(EventEmitter, { EventEmitter }), "node:events": Object.assign(EventEmitter, { EventEmitter }),
    url: { URL, URLSearchParams, parse: (u: string) => new URL(u, "http://localhost") },
    querystring: { parse: (s: string) => Object.fromEntries(new URLSearchParams(s)), stringify: (o: any) => new URLSearchParams(o).toString() },
    util: { promisify: (f: any) => (...a: any[]) => new Promise((res, rej) => f(...a, (e: any, v: any) => (e ? rej(e) : res(v)))), inspect: (o: any) => JSON.stringify(o) },
    stream: { Readable: EventEmitter, Writable: EventEmitter, PassThrough: EventEmitter },
    zlib: {}, net: { createServer: () => ({ listen: () => undefined }) }, tls: {}, dns: {},
    child_process: { exec: (_c: string, cb?: any) => cb?.(new Error("child_process is not available in the browser sandbox")), spawn: () => new EventEmitter() },
    buffer: { Buffer: BufferShim },
    express: pkgs.expressFactory,
    "socket.io": Object.assign(pkgs.socketIo, { Server: pkgs.socketIo.Server, default: pkgs.socketIo }),
    multer: pkgs.multer,
    cors: pkgs.cors,
    "body-parser": pkgs.bodyParser,
    dotenv: pkgs.dotenv,
    uuid: pkgs.uuid,
    nanoid: pkgs.nanoid,
    axios: Object.assign(pkgs.axios, { default: pkgs.axios }),
    "node-fetch": fetch,
    "@ngrok/ngrok": pkgs.ngrok,
    ngrok: pkgs.ngrok,
    ws: { WebSocketServer: class { on() { /* noop */ } }, Server: class { on() { /* noop */ } } },
    "socket.io-client": { io: () => ({ on: () => undefined, emit: () => undefined }) },
  };

  const requireFrom = (fromDir: string) => {
    const req: any = (spec: string) => {
      const cleaned = spec.replace(/^node:/, "");
      const resolved = resolveModule(spec, fromDir);
      if (resolved) return loadFile(resolved);
      if (builtins[spec]) return builtins[spec];
      if (builtins[cleaned]) return builtins[cleaned];
      throw new Error(
        `Cannot find module '${spec}'. Sam Cloud IDE emulates express, socket.io, multer, cors, body-parser, dotenv, axios, uuid, nanoid and the Node core modules.`,
      );
    };
    req.resolve = (s: string) => resolveModule(s, fromDir) || s;
    req.cache = {};
    return req;
  };

  const loadFile = (path: string): any => {
    if (cache.has(path)) return cache.get(path).exports;
    const node = fs[path];
    if (!node || node.type !== "file") throw new Error(`Cannot find module '${path}'`);
    if (path.endsWith(".json")) {
      const mod = { exports: JSON.parse(node.content) };
      cache.set(path, mod);
      return mod.exports;
    }
    const mod = { exports: {} as any };
    cache.set(path, mod);
    const dir = dirname(path);
    // very small ESM → CJS bridge so `import x from "y"` files still run
    let code = node.content;
    if (/^\s*(import|export)\s/m.test(code) && !/require\s*\(/.test(code)) {
      code = code
        .replace(/^\s*import\s+(\w+)\s*,\s*\{([^}]*)\}\s*from\s*["']([^"']+)["'];?/gm, 'const $1 = require("$3"); const {$2} = require("$3");')
        .replace(/^\s*import\s+\{([^}]*)\}\s*from\s*["']([^"']+)["'];?/gm, 'const {$1} = require("$2");')
        .replace(/^\s*import\s+(\w+)\s+from\s*["']([^"']+)["'];?/gm, 'const $1 = (m => m && m.default || m)(require("$2"));')
        .replace(/^\s*import\s*\*\s*as\s+(\w+)\s+from\s*["']([^"']+)["'];?/gm, 'const $1 = require("$2");')
        .replace(/^\s*export\s+default\s+/gm, "module.exports = ")
        .replace(/^\s*export\s+(const|let|var|function|class)\s+/gm, "$1 ");
    }
    // Placeholder ngrok tokens make projects short-circuit into a "public URL
    // not active" warning. The sandbox tunnel needs no real token, so swap the
    // placeholder for one (the file on disk is untouched).
    code = code.replace(/PASTE_YOUR_NGROK_AUTHTOKEN_HERE|YOUR_NGROK_AUTHTOKEN|<YOUR_NGROK_AUTHTOKEN>/g, SANDBOX_NGROK_TOKEN);
    const fn = new Function(
      "exports", "require", "module", "__filename", "__dirname", "console", "process", "Buffer", "global", "globalThis",
      `${code}\n//# sourceURL=${path}`,
    );
    const processShim = {
      // Do not force PORT: real projects commonly provide their own fallback
      // (for example `process.env.PORT || 5001`).
      env: sharedEnv,
      argv: ["node", path],
      platform: "browser",
      version: "v22.11.0",
      versions: { node: "22.11.0" },
      cwd: () => root || "/",
      exit: () => { throw new Error("process.exit() called"); },
      on: () => undefined,
      nextTick: (f: Function) => setTimeout(f, 0),
      stdout: { write: (s: string) => io.write(String(s)) },
      stderr: { write: (s: string) => io.error(String(s)) },
      memoryUsage: () => ({ heapUsed: 0 }),
      uptime: () => 0,
    };
    fn(mod.exports, requireFrom(dir), mod, path, dir, consoleShim, processShim, BufferShim, globalThis, globalThis);
    return mod.exports;
  };

  loadFile(entry);
  // give listen() callbacks a tick to register
  await new Promise((r) => setTimeout(r, 30));
  return getServer() || null;
}

/* --------------------------------------------------------- client bridge */

/**
 * Script injected into the Preview iframe: routes fetch / XHR / socket.io
 * traffic to the virtual server running in the IDE tab.
 */
export function clientBridgeScript(port: number, initialPath = "/") {
  return `<script>
(function(){
  var pending = {}, seq = 0, sockets = {}, virtualPath = ${JSON.stringify(initialPath)};
  // In the embedded Preview the IDE is parent; in a detached tab it is opener.
  function host(){ return window.parent !== window ? window.parent : window.opener; }
  function post(msg){ var h = host(); if (h) h.postMessage(Object.assign({__vnode:true}, msg), '*'); }
  window.addEventListener('message', function(e){
    var d = e.data;
    if (!d || !d.__vnodeRes) return;
    if (d.kind === 'http') { var p = pending[d.id]; if (p) { delete pending[d.id]; p(d); } }
    else if (d.kind === 'sock') {
      var s = sockets[d.sid];
      if (s) (s.__h[d.event] || []).concat(s.__h['*']||[]).forEach(function(f){ try { f.apply(null, d.args); } catch(err){ console.error(err); } });
    }
  });
  function request(method, url, headers, body){
    return new Promise(function(resolve){
      var id = ++seq; pending[id] = resolve;
      post({ kind:'http', id:id, method:method, url:url, headers:headers||{}, body:body });
      setTimeout(function(){ if (pending[id]) { delete pending[id]; resolve({status:504, headers:{}, body:'Gateway timeout'}); } }, 15000);
    });
  }
  function renderNavigation(method, url, headers, body){
    request(method, url, headers || {}, body).then(function(r){
      var location = r.headers && (r.headers.location || r.headers.Location);
      if (location && r.status >= 300 && r.status < 400) {
        renderNavigation('GET', location, {}, undefined);
        return;
      }
      if (r.status >= 400) {
        document.open();
        document.write('<!doctype html><title>'+r.status+'</title><pre style="font:16px/1.5 system-ui;padding:24px;white-space:pre-wrap">'+String(r.body || ('HTTP '+r.status)).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];})+'</pre>');
        document.close();
        return;
      }
      try { virtualPath = new URL(url, 'http://localhost:${port}'+virtualPath).pathname; } catch(err) {}
      document.open();
      document.write(r.body || '');
      document.close();
    });
  }
  window.__samNavigate = function(url){
    var parsed;
    try { parsed = new URL(String(url || '/'), 'http://localhost:${port}'+virtualPath); } catch(err) { return; }
    renderNavigation('GET', parsed.pathname + parsed.search, {}, undefined);
  };
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || /^(mailto:|tel:|javascript:|data:)/i.test(href)) return;
    var parsed;
    try { parsed = new URL(href, 'http://localhost:${port}'+virtualPath); } catch(err) { return; }
    if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') return;
    e.preventDefault();
    renderNavigation('GET', parsed.pathname + parsed.search, {}, undefined);
  });
  document.addEventListener('submit', function(e){
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    var action = form.getAttribute('action') || virtualPath || '/';
    var parsed;
    try { parsed = new URL(action, 'http://localhost:${port}'+virtualPath); } catch(err) { return; }
    if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') return;
    e.preventDefault();
    var method = (form.getAttribute('method') || 'GET').toUpperCase();
    var data = new FormData(form);
    if (method === 'GET') {
      var query = new URLSearchParams(data).toString();
      renderNavigation('GET', parsed.pathname + (query ? '?'+query : parsed.search), {}, undefined);
    } else if ((form.enctype || '').toLowerCase() === 'multipart/form-data') {
      window.fetch(parsed.pathname + parsed.search, {method:method, body:data}).then(function(r){return r.text().then(function(body){return {status:r.status, headers:Object.fromEntries(r.headers.entries()), body:body};});}).then(function(r){
        var loc = r.headers.location;
        if (loc) renderNavigation('GET', loc, {}, undefined);
        else { document.open(); document.write(r.body || ''); document.close(); }
      });
    } else {
      renderNavigation(method, parsed.pathname + parsed.search, {'content-type':'application/x-www-form-urlencoded'}, new URLSearchParams(data).toString());
    }
  });
  var origFetch = window.fetch.bind(window);
  window.fetch = function(input, init){
    init = init || {};
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var isLocal = /^\\/(?!\\/)/.test(url) || url.indexOf('localhost') > -1 || url.indexOf('127.0.0.1') > -1 || (url && !/^https?:|^data:|^blob:/.test(url));
    if (!isLocal) return origFetch(input, init);
    var headers = {};
    if (init.headers) { try { new Headers(init.headers).forEach(function(v,k){ headers[k.toLowerCase()] = v; }); } catch(e){} }
    var bodyP = Promise.resolve(undefined), isB64 = false;
    if (init.body instanceof FormData) {
      var b = '----samide' + Math.random().toString(16).slice(2);
      headers['content-type'] = 'multipart/form-data; boundary=' + b;
      bodyP = (async function(){
        var chunks = [];
        var enc = new TextEncoder();
        for (var pair of init.body.entries()) {
          var k = pair[0], v = pair[1];
          if (v && v.name !== undefined && v.size !== undefined) {
            chunks.push(enc.encode('--'+b+'\\r\\nContent-Disposition: form-data; name="'+k+'"; filename="'+v.name+'"\\r\\nContent-Type: '+(v.type||'application/octet-stream')+'\\r\\n\\r\\n'));
            chunks.push(new Uint8Array(await v.arrayBuffer()));
            chunks.push(enc.encode('\\r\\n'));
          } else {
            chunks.push(enc.encode('--'+b+'\\r\\nContent-Disposition: form-data; name="'+k+'"\\r\\n\\r\\n'+v+'\\r\\n'));
          }
        }
        chunks.push(enc.encode('--'+b+'--\\r\\n'));
        var total = chunks.reduce(function(s,c){return s+c.length;},0), out = new Uint8Array(total), o = 0;
        chunks.forEach(function(c){ out.set(c,o); o += c.length; });
        isB64 = true;
        var s=''; for (var i=0;i<out.length;i+=0x8000) s += String.fromCharCode.apply(null, out.subarray(i,i+0x8000));
        return btoa(s);
      })();
    } else if (init.body != null) { bodyP = Promise.resolve(String(init.body)); }
    return bodyP.then(function(body){
      return request(init.method || 'GET', url, headers, body).then(function(r){
        var payload = r.isBase64 ? Uint8Array.from(atob(r.body), function(c){ return c.charCodeAt(0); }) : r.body;
        return new Response(payload, { status: r.status || 200, headers: r.headers || {} });
      });
    }).then(function(res){ return res; });
  };
  var NativeXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function(){
    var method = 'GET', url = '', headers = {}, listeners = {}, xhr = this;
    this.readyState = 0; this.status = 0; this.responseText = ''; this.response = '';
    this.open = function(m, u){ method = m || 'GET'; url = u || ''; xhr.readyState = 1; if (xhr.onreadystatechange) xhr.onreadystatechange(); };
    this.setRequestHeader = function(k, v){ headers[String(k).toLowerCase()] = String(v); };
    this.getResponseHeader = function(k){ return xhr.__headers && xhr.__headers[String(k).toLowerCase()] || null; };
    this.getAllResponseHeaders = function(){ return Object.entries(xhr.__headers || {}).map(function(x){return x[0]+': '+x[1];}).join('\r\n'); };
    this.addEventListener = function(k, f){ (listeners[k] = listeners[k] || []).push(f); };
    this.removeEventListener = function(k, f){ listeners[k] = (listeners[k] || []).filter(function(x){return x !== f;}); };
    this.abort = function(){};
    this.send = function(body){
      var isLocal = /^\/(?!\/)/.test(url) || url.indexOf('localhost') > -1 || url.indexOf('127.0.0.1') > -1 || (url && !/^https?:|^data:|^blob:/.test(url));
      if (!isLocal) {
        var native = new NativeXHR();
        native.open(method, url, true);
        Object.keys(headers).forEach(function(k){native.setRequestHeader(k, headers[k]);});
        native.onload = function(){ xhr.status=native.status; xhr.responseText=native.responseText; xhr.response=native.response; xhr.readyState=4; if(xhr.onload)xhr.onload(); (listeners.load||[]).forEach(function(f){f.call(xhr);}); };
        native.onerror = function(){ if(xhr.onerror)xhr.onerror(); (listeners.error||[]).forEach(function(f){f.call(xhr);}); };
        native.send(body); return;
      }
      request(method, url, headers, body == null ? undefined : String(body)).then(function(r){
        xhr.status = r.status || 200; xhr.__headers = r.headers || {}; xhr.responseText = r.body || ''; xhr.response = xhr.responseText; xhr.readyState = 4;
        if (xhr.onreadystatechange) xhr.onreadystatechange();
        if (xhr.onload) xhr.onload();
        (listeners.load || []).forEach(function(f){ f.call(xhr); });
      });
    };
  };
  window.io = function(){
    var sid = 'sock_' + Math.random().toString(36).slice(2);
    var s = { id: sid, connected: true, __h: {},
      on: function(ev, f){ (this.__h[ev] = this.__h[ev] || []).push(f); if (ev === 'connect') setTimeout(f, 0); return this; },
      once: function(ev, f){ return this.on(ev, f); },
      off: function(ev){ delete this.__h[ev]; return this; },
      emit: function(ev){ post({ kind:'sock', op:'emit', sid:sid, event:ev, args:[].slice.call(arguments,1) }); return this; },
      disconnect: function(){ post({ kind:'sock', op:'disconnect', sid:sid }); this.connected = false; return this; } };
    sockets[sid] = s;
    post({ kind:'sock', op:'connect', sid:sid });
    return s;
  };
  window.io.connect = window.io;
  console.info('Sam Cloud IDE: connected to the virtual server on port ${port}');
})();
</script>`;
}
