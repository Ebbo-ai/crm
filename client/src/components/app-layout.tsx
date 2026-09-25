import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { AppSidebar } from "./app-sidebar";
import { QuickLogModal, useQuickLog } from "./quick-log-modal";
import { MailSyncButton } from "./mail-sync-button";
import { ArrowLeft, Menu, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

// How deep into the app a given history entry is. The number is stored ON the
// history entry itself rather than in a module counter, because a counter
// cannot tell a Back from a Forward: both fire popstate, so a counter drifts
// out of step the moment the user presses Forward. Riding on the entry means
// Back, Forward and reload all restore the correct value for free.
const DEPTH_KEY = "__spBackDepth";

function readDepth(): number {
  const state = window.history.state as Record<string, unknown> | null;
  const depth = state?.[DEPTH_KEY];
  return typeof depth === "number" && depth >= 0 ? depth : 0;
}

// Stamping happens here, at the history boundary, and NOT from a React effect.
// Two reasons, both of which produced wrong answers when this was effect-based:
//
//  1. wouter's navigate calls history.replaceState(null, ...) for a replace,
//     which wipes any depth an effect had written. A replace stands in for the
//     entry it overwrites, so it has to inherit that entry's depth, not gain one.
//  2. wouter's location is the pathname only, so pushing the path you are
//     already on (or changing just the query) never re-renders, and an effect
//     keyed on location would leave that entry unstamped and looking like a
//     fresh deep link.
//
// wouter looks history.pushState up dynamically at call time, so wrapping it
// after wouter's own patch catches every navigation the router makes.
function patchHistoryDepth() {
  if (typeof window === "undefined") return;
  const history = window.history as History & { __spDepthPatched?: boolean };
  if (history.__spDepthPatched) return;
  history.__spDepthPatched = true;

  // Whatever entry the session opens on is the ground floor, depth 0, whether
  // that is the dashboard or a deep link pasted into a new tab.
  const ground = (history.state ?? {}) as Record<string, unknown>;
  if (typeof ground[DEPTH_KEY] !== "number") {
    history.replaceState({ ...ground, [DEPTH_KEY]: 0 }, "");
  }

  const wrap = (method: "pushState" | "replaceState", nextDepth: (current: number) => number) => {
    const original = history[method].bind(history);
    history[method] = (state: unknown, unused: string, url?: string | URL | null) => {
      const carried = state && typeof state === "object" ? state : {};
      return original({ ...carried, [DEPTH_KEY]: nextDepth(readDepth()) }, unused, url);
    };
  };

  wrap("pushState", (current) => current + 1);
  wrap("replaceState", (current) => current);
}

patchHistoryDepth();

const PARENT_ROUTES: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
  [/^\/clients\/new\/?$/, () => "/clients"],
  [/^\/clients\/([^/]+)\/edit\/?$/, match => `/clients/${match[1]}`],
  [/^\/clients\/([^/]+)\/?$/, () => "/clients"],
  [/^\/clients\/?$/, () => "/dashboard"],
  [/^\/(?:issues|inbox|general|ppr-import|ppr-batch|reports|renewal-alerts)\/?$/, () => "/dashboard"],
  [/^\/settings\/(?:users|crm-import|data-reset)\/?$/, () => "/dashboard"],
  [/.*/, () => "/dashboard"],
];

function PageBackControl() {
  const [location, setLocation] = useLocation();
  const pathname = location.split(/[?#]/)[0] || "/";

  if (pathname === "/" || pathname === "/dashboard" || pathname === "/login") {
    return null;
  }

  const handleBack = () => {
    // Read at click time rather than holding depth in state: the entry is the
    // single source of truth, and this cannot go stale on a navigation that
    // did not re-render us.
    if (readDepth() > 0) {
      window.history.back();
      return;
    }

    // Nothing of ours behind us, so going back would leave the app. Go to the
    // page this one logically hangs off instead.
    const [parentPattern, getParent] = PARENT_ROUTES.find(([pattern]) => pattern.test(pathname))!;
    const match = pathname.match(parentPattern)!;
    setLocation(getParent(match), { replace: true });
  };

  return (
    <div className="mb-4">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleBack}
        className="gap-2 text-muted-foreground hover:text-brand"
        aria-label="Go back to the previous page"
        data-testid="button-page-back"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back
      </Button>
    </div>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const { open, defaultClientId, openQuickLog, closeQuickLog } = useQuickLog();

  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);
      if (mobile) setCollapsed(true);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />

      {!collapsed && isMobile && (
        <div
          className="fixed inset-0 bg-black/30 z-30 lg:hidden"
          onClick={() => setCollapsed(true)}
        />
      )}

      <div className={`transition-all duration-300 ${collapsed ? "lg:ml-16 ml-0" : "ml-64"}`}>
        <header className="sticky top-0 z-20 bg-card border-b border-border px-4 h-14 flex items-center gap-3">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setCollapsed(!collapsed)}
            data-testid="button-sidebar-toggle"
            className="text-foreground"
          >
            <Menu className="w-5 h-5" />
          </Button>

          <div className="flex-1" />

          {/* In the header rather than on the mail page: Kim and Steve both
              need "is my mail current?" answerable from wherever they are. */}
          <MailSyncButton />

          <Button
            onClick={() => openQuickLog()}
            size="sm"
            className="bg-brand hover:bg-brand-dark text-brand-foreground gap-2 h-8 px-3 text-xs"
            data-testid="button-quick-log-header"
          >
            <Zap className="w-3.5 h-3.5 text-warning-strong" />
            Quick Log
            <span className="hidden sm:inline text-xs opacity-60 font-mono ml-0.5">Ctrl+Shift+E</span>
          </Button>
        </header>

        <main className="p-4 lg:p-6 min-h-[calc(100vh-3.5rem)]">
          <PageBackControl />
          {children}
        </main>
      </div>

      <QuickLogModal open={open} onClose={closeQuickLog} defaultClientId={defaultClientId} />
    </div>
  );
}
