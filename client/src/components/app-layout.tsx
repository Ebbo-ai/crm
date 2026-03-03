import { useState, useEffect } from "react";
import { AppSidebar } from "./app-sidebar";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

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
    <div className="min-h-screen bg-[#F0F4F8]">
      <AppSidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />

      {!collapsed && isMobile && (
        <div
          className="fixed inset-0 bg-black/30 z-30 lg:hidden"
          onClick={() => setCollapsed(true)}
        />
      )}

      <div className={`transition-all duration-300 ${collapsed ? "lg:ml-16 ml-0" : "ml-64"}`}>
        <header className="sticky top-0 z-20 bg-white border-b border-gray-200 px-4 h-14 flex items-center gap-3">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setCollapsed(!collapsed)}
            data-testid="button-sidebar-toggle"
            className="text-[#2C3E50]"
          >
            <Menu className="w-5 h-5" />
          </Button>
        </header>

        <main className="p-4 lg:p-6 min-h-[calc(100vh-3.5rem)]">
          {children}
        </main>
      </div>
    </div>
  );
}
