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
import SettingsSendingPage from "@/pages/settings-sending";
import IssuesPage from "@/pages/issues";
import InboxPage from "@/pages/inbox";
import GeneralPage from "@/pages/general";
import PprBatchPage from "@/pages/ppr-batch";
import PprImportPage from "@/pages/ppr-import";
import ReportsPage from "@/pages/reports";
import RenewalAlertsPage from "@/pages/renewal-alerts";
import CrmImportPage from "@/pages/crm-import";
import DataResetPage from "@/pages/data-reset";
import GmailImportPage from "@/pages/gmail-import";
import FieldReviewPage from "@/pages/field-review";
import MailPage from "@/pages/mail";
import MailAccountsPage from "@/pages/mail-accounts";
import GmailBackfillPage from "@/pages/gmail-backfill";
import NotFound from "@/pages/not-found";
import TodayPage from "@/pages/today";

function ProtectedRoute({ component: Component, adminOnly }: { component: React.ComponentType; adminOnly?: boolean }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-subtle">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Loading...</p>
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
      <Route path="/today">{() => <ProtectedRoute component={TodayPage} />}</Route>
      <Route path="/clients">{() => <ProtectedRoute component={ClientsPage} />}</Route>
      <Route path="/clients/new">{() => <ProtectedRoute component={ClientFormPage} />}</Route>
      <Route path="/clients/:id/edit">{() => <ProtectedRoute component={ClientFormPage} />}</Route>
      <Route path="/clients/:id">{() => <ProtectedRoute component={ClientDetailPage} />}</Route>
      <Route path="/issues">{() => <ProtectedRoute component={IssuesPage} />}</Route>
      <Route path="/inbox">{() => <ProtectedRoute component={InboxPage} />}</Route>
      <Route path="/general">{() => <ProtectedRoute component={GeneralPage} />}</Route>
      <Route path="/ppr-import">{() => <ProtectedRoute component={PprImportPage} />}</Route>
      <Route path="/ppr-batch">{() => <ProtectedRoute component={PprBatchPage} />}</Route>
      <Route path="/reports">{() => <ProtectedRoute component={ReportsPage} />}</Route>
      <Route path="/renewal-alerts">{() => <ProtectedRoute component={RenewalAlertsPage} />}</Route>
      <Route path="/settings/users">{() => <ProtectedRoute component={SettingsUsersPage} adminOnly />}</Route>
      <Route path="/settings/sending">{() => <ProtectedRoute component={SettingsSendingPage} adminOnly />}</Route>
      <Route path="/settings/crm-import">{() => <ProtectedRoute component={CrmImportPage} adminOnly />}</Route>
      <Route path="/settings/data-reset">{() => <ProtectedRoute component={DataResetPage} adminOnly />}</Route>
      <Route path="/settings/gmail-import">{() => <ProtectedRoute component={GmailImportPage} adminOnly />}</Route>
      <Route path="/settings/mail-accounts">{() => <ProtectedRoute component={MailAccountsPage} adminOnly />}</Route>
      <Route path="/settings/gmail-backfill">{() => <ProtectedRoute component={GmailBackfillPage} adminOnly />}</Route>
      <Route path="/field-review">{() => <ProtectedRoute component={FieldReviewPage} />}</Route>
      <Route path="/mail">{() => <ProtectedRoute component={MailPage} />}</Route>
      <Route>{() => <ProtectedRoute component={NotFound} />}</Route>
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
