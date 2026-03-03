import { useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { LayoutDashboard, Users, Settings, Shield, LogOut, Search } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";

const navItems = [
  { title: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { title: "Clients", path: "/clients", icon: Users },
];

const adminItems = [
  { title: "Settings", path: "/settings/users", icon: Settings },
];

export function AppSidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearch(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients/search?q=${encodeURIComponent(searchQuery)}`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data);
        }
      } catch {}
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const isActive = (path: string) => {
    if (path === "/dashboard") return location === "/dashboard" || location === "/";
    return location.startsWith(path);
  };

  return (
    <aside
      className={`fixed left-0 top-0 h-full bg-[#1A5276] text-white z-40 transition-all duration-300 flex flex-col ${
        collapsed ? "w-0 -translate-x-full lg:w-16 lg:translate-x-0" : "w-64"
      }`}
      data-testid="sidebar"
    >
      <div className={`p-4 border-b border-white/10 ${collapsed ? "hidden lg:flex lg:flex-col lg:items-center lg:py-4" : ""}`}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
            <Shield className="w-5 h-5 text-[#F5A623]" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <h1 className="font-bold text-sm leading-tight truncate">Simple Benefits</h1>
              <p className="text-[10px] text-[#F5A623] leading-tight">Client Management System</p>
            </div>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="px-3 pt-3" ref={searchRef}>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
            <Input
              type="search"
              placeholder="Search clients..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSearch(true);
              }}
              onFocus={() => setShowSearch(true)}
              className="h-8 pl-8 bg-white/10 border-white/10 text-white placeholder:text-white/40 text-xs focus:bg-white/15"
              data-testid="input-global-search"
            />
            {showSearch && searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-md shadow-lg z-50 max-h-64 overflow-auto" data-testid="search-results-dropdown">
                {searchResults.map((client: any) => (
                  <Link
                    key={client.id}
                    href={`/clients/${client.id}`}
                    onClick={() => { setShowSearch(false); setSearchQuery(""); }}
                  >
                    <div className="px-3 py-2 hover:bg-[#F0F4F8] cursor-pointer border-b border-gray-100 last:border-0" data-testid={`search-result-${client.id}`}>
                      <div className="text-sm font-medium text-[#2C3E50]">{client.clientName}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-[#94A3B8]">{client.city}, {client.state}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          client.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                        }`}>
                          {client.isActive ? "Active" : "Terminated"}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
            {showSearch && searchQuery.length >= 2 && searchResults.length === 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-md shadow-lg z-50 p-3 text-center text-sm text-[#94A3B8]">
                No clients found
              </div>
            )}
          </div>
        </div>
      )}

      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => (
          <Link key={item.path} href={item.path}>
            <div
              className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                isActive(item.path)
                  ? "bg-white/15 text-white"
                  : "text-white/70 hover:bg-white/10 hover:text-white"
              } ${collapsed ? "justify-center" : ""}`}
              data-testid={`nav-${item.title.toLowerCase()}`}
            >
              <item.icon className="w-4.5 h-4.5 flex-shrink-0" />
              {!collapsed && <span>{item.title}</span>}
            </div>
          </Link>
        ))}

        {user?.role === "ADMIN" && (
          <>
            <div className={`my-2 border-t border-white/10 ${collapsed ? "mx-2" : "mx-3"}`} />
            {adminItems.map((item) => (
              <Link key={item.path} href={item.path}>
                <div
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                    isActive(item.path)
                      ? "bg-white/15 text-white"
                      : "text-white/70 hover:bg-white/10 hover:text-white"
                  } ${collapsed ? "justify-center" : ""}`}
                  data-testid={`nav-${item.title.toLowerCase()}`}
                >
                  <item.icon className="w-4.5 h-4.5 flex-shrink-0" />
                  {!collapsed && <span>{item.title}</span>}
                </div>
              </Link>
            ))}
          </>
        )}
      </nav>

      <div className={`p-3 border-t border-white/10 ${collapsed ? "hidden lg:block" : ""}`}>
        {!collapsed && (
          <div className="flex items-center gap-2 px-2 mb-2">
            <div className="w-7 h-7 rounded-full bg-[#F5A623] flex items-center justify-center text-xs font-bold text-[#1A5276] flex-shrink-0">
              {user?.fullName?.charAt(0) || "U"}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium truncate">{user?.fullName}</p>
              <p className="text-[10px] text-white/50 truncate">{user?.email}</p>
            </div>
          </div>
        )}
        <button
          onClick={logout}
          className={`flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors ${
            collapsed ? "justify-center" : ""
          }`}
          data-testid="button-logout"
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>
    </aside>
  );
}
