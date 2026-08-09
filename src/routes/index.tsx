import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";

const IDE = lazy(() => import("@/components/ide/IDE"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sam Cloud IDE — Browser-Based Code Editor" },
      { name: "description", content: "VS Code-inspired browser IDE: Monaco editor, live preview, Python runtime, integrated terminal, webcam, and file management." },
      { property: "og:title", content: "Sam Cloud IDE" },
      { property: "og:description", content: "Code, compile, preview and run in your browser." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <>
      <ClientOnly fallback={<LoadingScreen />}>
        <Suspense fallback={<LoadingScreen />}>
          <IDE />
        </Suspense>
      </ClientOnly>
      <Toaster theme="dark" position="bottom-right" />
    </>
  );
}

function LoadingScreen() {
  return (
    <div className="h-screen w-screen grid place-items-center bg-background">
      <div className="text-center space-y-3">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-[oklch(0.6_0.22_240)] to-[oklch(0.5_0.25_290)] grid place-items-center pulse-neon">
          <i className="bi bi-code-slash text-white text-2xl" />
        </div>
        <div className="text-lg font-semibold">Sam <span className="neon-text">Cloud</span> IDE</div>
        <div className="text-xs text-muted-foreground">Loading editor...</div>
      </div>
    </div>
  );
}
