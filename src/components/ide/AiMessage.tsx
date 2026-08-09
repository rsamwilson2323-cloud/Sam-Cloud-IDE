import { useState, type ReactNode } from "react";
import { toast } from "sonner";

type Part =
  | { kind: "text"; text: string }
  | { kind: "code"; lang: string; code: string };

function parse(md: string): Part[] {
  const parts: Part[] = [];
  const re = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    if (m.index > last) parts.push({ kind: "text", text: md.slice(last, m.index) });
    parts.push({ kind: "code", lang: (m[1] || "").toLowerCase(), code: m[2].replace(/\n$/, "") });
    last = m.index + m[0].length;
  }
  if (last < md.length) parts.push({ kind: "text", text: md.slice(last) });
  return parts;
}

function InlineText({ text }: { text: string }) {
  // Render inline `code` spans and preserve line breaks
  const nodes: ReactNode[] = [];
  const re = /`([^`\n]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    nodes.push(
      <code key={`c${i++}`} className="px-1 py-0.5 rounded bg-white/10 text-[oklch(0.85_0.15_180)] text-[12.5px]">
        {m[1]}
      </code>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <span className="whitespace-pre-wrap">{nodes}</span>;
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Copy failed");
    }
  };
  return (
    <div className="my-2 rounded-lg overflow-hidden border border-white/10 bg-[oklch(0.12_0.02_260)]">
      <div className="flex items-center justify-between px-2.5 py-1 bg-white/5 border-b border-white/10">
        <span className="text-[11px] uppercase tracking-widest text-muted-foreground">{lang || "code"}</span>
        <button
          onClick={copy}
          className="text-[11px] px-2 py-0.5 rounded hover:bg-white/10 text-foreground/80 flex items-center gap-1"
        >
          <i className={`bi ${copied ? "bi-check2" : "bi-clipboard"}`} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="p-2.5 text-[12.5px] leading-5 overflow-x-auto scroll-thin">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function AiMessage({ text }: { text: string }) {
  const parts = parse(text);
  return (
    <div className="space-y-1 text-foreground/90">
      {parts.map((p, i) =>
        p.kind === "code" ? (
          <CodeBlock key={i} lang={p.lang} code={p.code} />
        ) : (
          <div key={i} className="text-[13.5px] leading-6">
            <InlineText text={p.text} />
          </div>
        ),
      )}
    </div>
  );
}
