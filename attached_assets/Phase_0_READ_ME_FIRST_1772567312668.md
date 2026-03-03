# Simple Benefits CMS — Replit Build Guide

## How This Works

You have 6 phase files (Phase 1 through Phase 6). Each one is a set of instructions you paste into Replit's AI Agent chat.

## Step-by-Step

1. **Go to replit.com** and sign in (or create a free account)
2. **Click "Create Repl"** → Choose **Next.js** as the template → Name it `simple-benefits-cms`
3. **Open the AI Agent** (the chat panel on the right side, or click the "Agent" tab)
4. **Open Phase_1** file, copy ALL the text, paste it into the Agent chat, and press Enter
5. **Wait for the Agent to finish building.** It will create files, install packages, and set things up. This can take a few minutes.
6. **Click the green "Run" button** at the top to test. Make sure the app loads without errors.
7. **If there are errors**, tell the Agent: "I'm getting this error: [paste the error]" and let it fix it.
8. **Once Phase 1 is working**, open Phase_2 file, copy ALL text, paste into Agent, and repeat.
9. **Continue through all 6 phases**, testing after each one.

## Important Tips

- **Don't skip phases.** Each one builds on the previous.
- **Test after every phase.** Don't move on until the current phase works.
- **If the Agent gets confused**, you can say: "Stop. Let's start fresh on this phase. Here are the instructions again:" and re-paste.
- **Replit uses PostgreSQL** — the Agent will set up the database for you automatically.
- **Save often.** Replit auto-saves, but it doesn't hurt to verify.

## What Gets Built

| Phase | What It Builds |
|-------|---------------|
| 1 | Project setup, database, user login system |
| 2 | Client profiles, contacts, broker info |
| 3 | Benefit plans, coverage tiers, rates & fees |
| 4 | Plan history/archiving, document uploads |
| 5 | Issue tracking (with flashing indicator), PPR uploads, banking/funding |
| 6 | Dashboard, search, UI polish, final touches |

## Tech Stack (For Reference)

- **Frontend:** Next.js with React and Tailwind CSS
- **Backend:** Next.js API routes (Node.js)
- **Database:** PostgreSQL with Prisma ORM
- **Authentication:** NextAuth.js (email/password login)
- **File Storage:** Local uploads (Replit filesystem)

You don't need to understand any of this to use the phases — just paste and let the Agent build.
