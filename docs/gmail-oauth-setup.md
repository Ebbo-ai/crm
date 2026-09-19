# Connecting Gmail: Kim, clientservice@, and Steve

The CRM now has its own Google sign-in (separate from the one-account Replit
connector it used before). This lets three mailboxes stay connected at the
same time: kim.anderson@simple.us, clientservice@simple.us, and
steve.schultz@simple.us. Each one is authorized independently in Settings →
Mail Accounts, but first the CRM's Google app itself has to exist. That's a
one-time setup in Google Cloud. This walkthrough assumes no prior experience
with Google Cloud.

**Follow every step exactly as written, in order — especially Step 3.**
Picking the wrong consent screen type there requires Google's review process
to fix (days to weeks, and sometimes a paid third-party security assessment).

---

## Step 1 — Create a Google Cloud project

1. Go to https://console.cloud.google.com/ and sign in with an account on
   your Google Workspace (an @simple.us or your organization's admin
   account — not a personal Gmail).
2. Click the project dropdown at the top of the page, then **New Project**.
3. Name it something recognizable, e.g. "Simple Benefits CRM".
4. Click **Create**. Wait for the notification that the project was
   created, then select it from the project dropdown so it's active.

## Step 2 — Enable the Gmail API

1. In the search bar at the top, type **Gmail API** and open it.
2. Click **Enable**.

## Step 3 — Configure the OAuth consent screen as INTERNAL

This is the step that must not be gotten wrong.

1. In the left sidebar, go to **APIs & Services → OAuth consent screen**.
2. Under **User Type**, choose **Internal**. Do **not** choose External.
   - Internal restricts the app to accounts on your own Google Workspace
     (your @simple.us accounts) and skips Google's verification/review
     process entirely for the scopes this app needs.
   - External would require your app to go through Google's verification,
     which for the Gmail scopes below can require a paid third-party
     security assessment and take weeks. If you don't see an "Internal"
     option, your Google account isn't on a Google Workspace — stop and let
     the CRM team know before proceeding.
3. Fill in the required fields: app name (e.g. "Simple Benefits CRM"),
   user support email, developer contact email. Save and continue.
4. On the **Scopes** page, click **Add or Remove Scopes** and add:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
   Save and continue through the remaining steps, then **Back to Dashboard**.

## Step 4 — Create the OAuth client credentials

1. Go to **APIs & Services → Credentials**.
2. Click **Create Credentials → OAuth client ID**.
3. Application type: **Web application**.
4. Name it e.g. "Simple Benefits CRM Web Client".
5. Under **Authorized redirect URIs**, click **Add URI** and add *both* of
   these, exactly as written (no trailing slash):
   - `https://bfd70422-b469-4516-b1ab-a0f40e838f3c-00-3a10plfgixz1d.kirk.replit.dev/api/oauth/gmail/callback`
   - `https://simplebenefits.replit.app/api/oauth/gmail/callback`
   The first is the development URL (what you see while editing in Replit);
   the second is the published app. Both must be present or authorization
   will fail with a "redirect_uri_mismatch" error in whichever environment
   is missing.
6. Click **Create**. A dialog shows a **Client ID** and **Client secret** —
   keep this dialog open, you'll need both values in the next step.

## Step 5 — Give the CRM the client ID and secret

Back in the CRM (Replit), these two values go into two secrets:

- `GOOGLE_OAUTH_CLIENT_ID` — the Client ID from Step 4.
- `GOOGLE_OAUTH_CLIENT_SECRET` — the Client secret from Step 4.

The CRM will prompt for these directly when they're needed — paste each
value in when asked. These are the only two secrets in this setup; each
mailbox's own authorization is stored separately once you connect it in the
next step, not as a secret.

## Step 6 — Connect each mailbox

1. In the CRM, go to **Settings → Mail Accounts**.
2. For each of the three mailboxes, click **Connect**.
3. You'll be sent to Google's sign-in/consent screen. **Sign in as that
   specific mailbox** (e.g. when connecting clientservice@simple.us, sign in
   as clientservice@simple.us, not your own account) and approve access.
4. Google redirects you back to the CRM, and the mailbox shows as
   **Connected**.
5. Repeat for all three mailboxes.

If a mailbox's authorization is later revoked or expires, its status
changes to **Needs reauthorization** on this same page — click **Reconnect**
and repeat the sign-in step for that mailbox.

## What each mailbox can do

All three mailboxes are authorized for both reading and sending
(`gmail.readonly` and `gmail.send`). For Kim's and clientservice@'s
mailboxes, the CRM reads and files everything, same as before. For Steve's
mailbox specifically, the CRM never reads mail wholesale — it only looks at
a message if the other party is a known business contact (a client, a
broker, or 90 Degree Benefits) or an employer/broker domain you've approved
in Settings → Mail Accounts. Everything else in Steve's mailbox is skipped
without the CRM ever storing so much as the subject line.

## The existing Replit Gmail connector

The CRM previously used Replit's own Gmail connector, bound to Kim's
mailbox. That connector is untouched and can stay as-is — it doesn't
conflict with this new setup. It can be removed later once you've confirmed
the new setup is working, but there's no urgency either way.
