import { dirname, type FSMap } from "./fs";
import { projectRootFor, resolveInRoot } from "./project";

function dataUrl(code: string) {
  return `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`;
}

/** dependencies declared in the project's package.json (root or parent-less). */
function depsFor(fs: FSMap, root: string): Record<string, string> {
  const pkgPath = root ? `${root}/package.json` : "package.json";
  const node = fs[pkgPath];
  if (!node || node.type !== "file") return {};
  try {
    const j = JSON.parse(node.content);
    return { ...(j.dependencies || {}), ...(j.devDependencies || {}) };
  } catch {
    return {};
  }
}

/** Map a bare npm specifier (three, three/addons/x.js, @scope/pkg) to an ESM CDN URL. */
function cdnUrl(spec: string, deps: Record<string, string>): string | null {
  if (/^(https?:|data:|\/\/|\.|\/)/.test(spec)) return null;
  const m = spec.match(/^(@[^/]+\/[^/]+|[^/]+)(\/.*)?$/);
  if (!m) return null;
  const name = m[1];
  const sub = m[2] || "";
  const raw = deps[name];
  const ver = raw && /\d/.test(String(raw)) ? `@${String(raw).replace(/^[\^~>=<\s]+/, "")}` : "";
  return `https://esm.sh/${name}${ver}${sub}`;
}

// Recursively inline a local ES module and its relative imports as data URLs.
function moduleUrl(fs: FSMap, root: string, path: string, seen: Map<string, string>, deps: Record<string, string> = {}): string {
  const cached = seen.get(path);
  if (cached) return cached;
  const node = fs[path];
  if (!node || node.type !== "file") return dataUrl(`console.error('missing module: ${path}')`);
  seen.set(path, dataUrl("export {}")); // cycle guard placeholder
  const base = dirname(path);
  const rewrite = (spec: string) => {
    if (!/^\.{1,2}\//.test(spec) && !spec.startsWith("/")) return cdnUrl(spec, deps);
    const resolved = resolveInRoot(root, spec.startsWith("/") ? root : base, spec.replace(/^\//, ""));
    if (!resolved) return null;
    const candidates = [resolved, `${resolved}.js`, `${resolved}/index.js`];
    const found = candidates.find((c) => fs[c] && fs[c].type === "file");
    if (!found) return null;
    return moduleUrl(fs, root, found, seen, deps);
  };
  const code = node.content.replace(
    /(\bfrom\s*|\bimport\s*|\bimport\s*\(\s*)(["'])([^"']+)\2/g,
    (m, pre, q, spec) => {
      const u = rewrite(spec);
      return u ? `${pre}${q}${u}${q}` : m;
    },
  );
  const url = dataUrl(`${code}\n//# sourceURL=${path}`);
  seen.set(path, url);
  return url;
}


function inlineCss(fs: FSMap, root: string, path: string, depth = 0): string {
  const node = fs[path];
  if (!node || node.type !== "file" || depth > 5) return "";
  const base = dirname(path);
  return node.content.replace(/@import\s+(?:url\()?["']([^"')]+)["']\)?\s*;/g, (m, href) => {
    if (/^(https?:|data:|\/\/)/i.test(href)) return m;
    const resolved = resolveInRoot(root, base, href);
    if (!resolved || !fs[resolved]) return `/* missing css: ${href} */`;
    return inlineCss(fs, root, resolved, depth + 1);
  });
}

/**
 * Build a self-contained HTML string for preview. Everything is resolved
 * relative to the entry file's project root — sub-folders included, parent
 * folders never.
 */
export function buildPreviewHtml(fs: FSMap, htmlPath: string, rootOverride?: string): string {
  const html = fs[htmlPath];
  if (!html || html.type !== "file") return "<!doctype html><body>File not found</body>";
  const root = rootOverride ?? projectRootFor(fs, htmlPath);
  const base = dirname(htmlPath);
  const modSeen = new Map<string, string>();
  let source = html.content;
  // Bare npm specifiers already mapped by an inline <script type="importmap"> win.
  const mappedByImportMap = new Set<string>();
  const imMatch = source.match(/<script\b[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i);
  if (imMatch) {
    try {
      const j = JSON.parse(imMatch[1]);
      for (const k of Object.keys(j.imports || {})) mappedByImportMap.add(k.replace(/\/$/, ""));
    } catch { /* ignore malformed import map */ }
  }
  const allDeps = depsFor(fs, root);
  const deps: Record<string, string> = allDeps;
  const bareUrl = (spec: string) => {
    const head = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    if (mappedByImportMap.has(head) || mappedByImportMap.has(spec)) return null;
    return cdnUrl(spec, deps);
  };


  const resolveRef = (ref: string) => resolveInRoot(root, ref.startsWith("/") ? root : base, ref.replace(/^\//, ""));

  // <link rel="stylesheet" href="...">
  source = source.replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, (tag) => {
    const m = tag.match(/href=["']([^"']+)["']/i);
    if (!m) return tag;
    const href = m[1];
    if (/^(https?:|data:|\/\/)/i.test(href)) return tag;
    const resolved = resolveRef(href);
    if (resolved && fs[resolved] && fs[resolved].type === "file") {
      return `<style data-from="${resolved}">\n${inlineCss(fs, root, resolved)}\n</style>`;
    }
    return `<!-- missing css: ${href} (outside project root or not found) -->`;
  });

  // <script src="...">
  source = source.replace(
    /<script\b([^>]*)src=["']([^"']+)["']([^>]*)>\s*<\/script>/gi,
    (tag, pre, src, post) => {
      if (/^(https?:|data:|\/\/)/i.test(src)) return tag;
      const attrs = `${pre} ${post}`.replace(/\s+/g, " ").trim();
      const isModule = /type=["']module["']/i.test(attrs);
      const resolved = resolveRef(src);
      if (!resolved || !fs[resolved] || fs[resolved].type !== "file") {
        return `<!-- missing js: ${src} (outside project root or not found) -->`;
      }
      if (isModule) {
        return `<script type="module" src="${moduleUrl(fs, root, resolved, modSeen, deps)}"></script>`;
      }
      return `<script data-from="${resolved}" ${attrs}>\n${(fs[resolved] as any).content}\n//# sourceURL=${resolved}\n</script>`;
    },
  );

  // Inline module scripts: rewrite relative imports (local files) and bare
  // npm specifiers (installed packages → ESM CDN) so real projects just run.
  source = source.replace(
    /<script\b([^>]*type=["']module["'][^>]*)>([\s\S]*?)<\/script>/gi,
    (tag, attrs, code) => {
      if (/\bsrc=/i.test(attrs)) return tag;
      const rewritten = code.replace(
        /(\bfrom\s*|\bimport\s*|\bimport\s*\(\s*)(["'])([^"']+)\2/g,
        (m: string, pre: string, q: string, spec: string) => {
          if (!/^\.{1,2}\//.test(spec) && !spec.startsWith("/")) {
            const cdn = bareUrl(spec);
            return cdn ? `${pre}${q}${cdn}${q}` : m;
          }
          const resolved = resolveRef(spec);
          const candidates = resolved ? [resolved, `${resolved}.js`, `${resolved}/index.js`] : [];
          const found = candidates.find((c) => fs[c] && fs[c].type === "file");
          return found ? `${pre}${q}${moduleUrl(fs, root, found, modSeen, deps)}${q}` : m;
        },
      );
      return `<script ${attrs}>${rewritten}</script>`;
    },
  );


  // Local media/img/source/iframe references → data URLs when binary
  source = source.replace(
    /<(img|source|video|audio|iframe)\b([^>]*?)src=["']([^"']+)["']/gi,
    (tag, el, attrs, src) => {
      if (/^(https?:|data:|\/\/|#)/i.test(src)) return tag;
      const resolved = resolveRef(src);
      const node = resolved ? fs[resolved] : undefined;
      if (node && node.type === "file") {
        if (node.binary && node.mime) return `<${el}${attrs}src="data:${node.mime};base64,${node.content}"`;
        const mime = resolved!.endsWith(".svg") ? "image/svg+xml" : "text/plain";
        return `<${el}${attrs}src="data:${mime};charset=utf-8,${encodeURIComponent(node.content)}"`;
      }
      return tag;
    },
  );

  // Error / console reporter
  const reporter = `
<script>
(function(){
  function send(payload){ try { parent.postMessage({__samIde:true, ...payload}, '*'); } catch(e){} }
  window.addEventListener('error', e => send({kind:'error', message:e.message, source:e.filename, line:e.lineno, col:e.colno}));
  window.addEventListener('unhandledrejection', e => send({kind:'error', message:'Unhandled rejection: '+(e.reason && e.reason.message || e.reason)}));
  ['log','warn','error','info'].forEach(fn=>{
    const orig = console[fn];
    console[fn] = function(...a){ send({kind:'console', level:fn, args:a.map(x=>{ try { return typeof x==='object'? JSON.stringify(x): String(x); } catch { return String(x); } })}); orig.apply(console,a); };
  });
})();
</script>`;
  if (/<\/head>/i.test(source)) source = source.replace(/<\/head>/i, reporter + "</head>");
  else source = reporter + source;

  return source;
}
