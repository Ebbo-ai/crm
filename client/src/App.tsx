import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { AppLayout } from "@/components/app-layout";
import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";
import ClientsPage from "@/pages/clients";
import ClientFormPage from "@/pages/client-form";
import ClientDetailPage from "@/pages/client-detail";
import SettingsUsersPage from "@/pages/settings-users";
import IssuesPage from "@/pages/issues";
import InboxPage from "@/pages/inbox";
import NotFound from "@/pages/not-found";

function ProtectedRoute({ component: Component, adminOnly }: { component: React.ComponentType; adminOnly?: boolean }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F0F4F8]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#1A5276] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-[#94A3B8]">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return <Redirect to="/login" />;
  if (adminOnly && user.role !== "ADMIN") return <Redirect to="/dashboard" />;

  return (
    <AppLayout>
      <Component />
    </AppLayout>
  );
}

function AuthRedirect() {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (user) return <Redirect to="/dashboard" />;
  return <LoginPage />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={AuthRedirect} />
      <Route path="/">{() => <ProtectedRoute component={DashboardPage} />}</Route>
      <Route path="/dashboard">{() => <ProtectedRoute component={DashboardPage} />}</Route>
      <Route path="/clients">{() => <ProtectedRoute component={ClientsPage} />}</Route>
      <Route path="/clients/new">{() => <ProtectedRoute component={ClientFormPage} />}</Route>
      <Route path="/clients/:id/edit">{() => <ProtectedRoute component={ClientFormPage} />}</Route>
      <Route path="/clients/:id">{() => <ProtectedRoute component={ClientDetailPage} />}</Route>
      <Route path="/issues">{() => <ProtectedRoute component={IssuesPage} />}</Route>
      <Route path="/inbox">{() => <ProtectedRoute component={InboxPage} />}</Route>
      <Route path="/settings/users">{() => <ProtectedRoute component={SettingsUsersPage} adminOnly />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <Toaster />
          <Router />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
