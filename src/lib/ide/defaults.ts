import type { FSMap } from "./fs";

export const DEFAULT_FS: FSMap = {
  "index.html": {
    type: "file",
    content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Welcome to Sam Cloud IDE</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div class="bg"></div>
  <main class="card">
    <h1>Sam <span class="neon">Cloud</span> IDE</h1>
    <p class="tag">Code. Compile. Preview. In your browser.</p>
    <div class="grid">
      <div class="tile">⚡ Monaco Editor</div>
      <div class="tile">🐍 Python (Pyodide)</div>
      <div class="tile">🌐 Live Preview</div>
      <div class="tile">📷 Webcam</div>
      <div class="tile">💻 Terminal</div>
      <div class="tile">📁 File Tree</div>
    </div>
    <button id="b" class="cta">Click me ✨</button>
    <p id="out" class="out"></p>
  </main>
  <script src="script.js"></script>
</body>
</html>
`,
  },
  "style.css": {
    type: "file",
    content: `* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; font-family: ui-sans-serif, system-ui, sans-serif; color: #e7ecff; overflow:hidden; }
body { display:grid; place-items:center; background:#0b1020; }
.bg {
  position: fixed; inset: 0; z-index: 0;
  background:
    radial-gradient(800px 500px at 10% 10%, #1e3a8a55, transparent 60%),
    radial-gradient(700px 500px at 90% 90%, #7c3aed44, transparent 60%),
    radial-gradient(500px 400px at 50% 50%, #06b6d433, transparent 60%);
  filter: blur(40px);
  animation: float 14s ease-in-out infinite alternate;
}
@keyframes float { from { transform: translateY(-12px); } to { transform: translateY(12px); } }
.card {
  position: relative; z-index: 1; padding: 48px 56px; max-width: 720px; width: 92%;
  background: rgba(15,22,45,.55); border:1px solid rgba(255,255,255,.08);
  border-radius: 24px; backdrop-filter: blur(24px) saturate(160%);
  box-shadow: 0 20px 60px rgba(0,0,0,.5);
  text-align: center;
}
h1 { font-size: clamp(36px, 6vw, 64px); letter-spacing:-.02em; font-weight: 800; }
.neon { color:#60a5fa; text-shadow: 0 0 16px #60a5fa99; }
.tag { color:#a3b3d6; margin-top: 6px; }
.grid { display:grid; grid-template-columns: repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin: 28px 0; }
.tile { padding: 14px; border-radius: 12px; background: rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.07); font-size: 14px; transition: transform .2s ease; }
.tile:hover { transform: translateY(-3px); border-color:#60a5fa; }
.cta {
  padding: 12px 28px; font-size: 15px; border-radius: 999px; border:0; cursor:pointer;
  background: linear-gradient(135deg,#3b82f6,#8b5cf6); color:white; font-weight:600;
  box-shadow: 0 8px 20px #3b82f655;
  transition: transform .15s ease;
}
.cta:hover { transform: translateY(-2px); }
.out { margin-top: 14px; color:#a3b3d6; min-height: 1.2em; }
`,
  },
  "script.js": {
    type: "file",
    content: `const btn = document.getElementById('b');
const out = document.getElementById('out');
let n = 0;
btn.addEventListener('click', () => {
  n += 1;
  out.textContent = 'You clicked ' + n + ' time' + (n === 1 ? '' : 's') + ' — preview is live!';
});
console.log('Sam Cloud IDE preview loaded ✨');
`,
  },
  "main.py": {
    type: "file",
    content: `# Sample Python — runs in your browser via Pyodide
# Click ▶ Run to execute.

def fib(n):
    a, b = 0, 1
    for _ in range(n):
        yield a
        a, b = b, a + b

print("First 10 Fibonacci numbers:")
print(list(fib(10)))

name = input("What's your name? ")
print(f"Hello, {name}! Welcome to Sam Cloud IDE 🐍")
`,
  },
  README: { type: "file", content: `# Sam Cloud IDE

Welcome! This IDE runs entirely in your browser.

- **HTML/CSS/JS** → Click ▶ Run to live-preview. Linked CSS/JS files in the same folder are merged automatically (just like VS Code Live Server).
- **Python** → Real Python via Pyodide. \`pip install <pkg>\` works in the terminal (uses micropip).
- **Webcam** → Click the camera button in the top bar to grant access; preview shows on the right.
- **Terminal** → \`ls\`, \`cd\`, \`cat\`, \`mkdir\`, \`touch\`, \`rm\`, \`pip\`, \`python\`, \`node\`, \`clear\`.

C/C++/Java/PHP need a server-side runner (Docker sandbox) — not available in this static deploy.
` },
  cake: { type: "folder" },
  "cake/index.html": {
    type: "file",
    content: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Cake</title><link rel="stylesheet" href="script.css"></head>
<body>
  <h1>🎂 Cake Folder Demo</h1>
  <p>Click the button — the folder is being merged like VS Code Live Server.</p>
  <button id="go">Bake</button>
  <div id="msg"></div>
  <script src="server.js"></script>
</body></html>`,
  },
  "cake/script.css": {
    type: "file",
    content: `body{font-family:system-ui;background:#1a0f1f;color:#fde7f3;display:grid;place-items:center;min-height:100vh;text-align:center}
h1{font-size:48px}
button{padding:12px 24px;border-radius:999px;border:0;background:#ec4899;color:#fff;font-size:16px;cursor:pointer}
#msg{margin-top:20px;color:#fbcfe8}`,
  },
  "cake/server.js": {
    type: "file",
    content: `document.getElementById('go').addEventListener('click',()=>{
  document.getElementById('msg').textContent='🍰 Cake baked at '+new Date().toLocaleTimeString();
});`,
  },
};
