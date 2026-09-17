# Resource Planner

A team time-logging app: Time Logger, Dashboard, All Logs, Settings, CSV export.

**Data is now shared and live** across everyone who opens the app — it's stored in a
Cloudflare D1 database (not browser localStorage), read and written through a small
API running as Cloudflare Pages Functions.

⚠️ **No login.** Anyone with the URL can view and edit all data — add/remove members,
log time, change capacity settings. That's fine for a small trusted internal team on
a private/internal link, but don't put anything sensitive in here or share the URL
publicly without adding access control in front of it.

## One-time setup: create the D1 database

You need to do this once, before your first deploy.

1. Install Wrangler if you don't have it: `npm install -g wrangler`
2. Log in: `wrangler login`
3. Create the database:
   ```
   wrangler d1 create resource-planner-db
   ```
   This prints a `database_id` — copy it.
4. Open `wrangler.toml` in this folder and paste that id in place of
   `REPLACE_WITH_YOUR_D1_DATABASE_ID`.
5. Load the schema and seed data into the database:
   ```
   wrangler d1 execute resource-planner-db --remote --file=./schema.sql
   ```
   (Drop `--remote` if you want to test locally first with `wrangler pages dev` —
   in that case also run the same command without `--remote` to seed the local copy.)

## Deploy

Push all files (including the `functions/` folder, `wrangler.toml`, and `schema.sql`)
to the root of your GitHub repository, then in Cloudflare:

1. Go to **Workers & Pages → Create → Pages → Connect to Git**, pick this repo.
2. Cloudflare should detect `wrangler.toml` and read the D1 binding automatically.
   If it doesn't show up under the Pages project's **Settings → Functions →
   D1 database bindings**, add it manually there: variable name `DB`, pick
   `resource-planner-db`.
3. Deploy. No build command is required — it's a static-assets project with a
   Functions API attached.

After deploying, open the site — the Time Logger, Dashboard, etc. will load data
from `/api/data` instead of localStorage. Any changes anyone makes are immediately
visible to everyone else who has the page open (on their next refresh or navigation).

## Local development

```
wrangler pages dev . --d1=DB=resource-planner-db
```

## How it works

- `index.html` / `styles.css` / `app.js` — the frontend (unchanged in spirit from
  before, just now talking to `/api/*` instead of localStorage).
- `functions/api/[[path]].js` — a single Cloudflare Pages Function that handles all
  API routes (`GET /api/data`, `POST /api/members`, `POST /api/tasks`,
  `POST /api/logs/save`, `PUT /api/capacity`, etc.) against the D1 database.
- `schema.sql` — table definitions and seed data for the D1 database.
- `wrangler.toml` — Pages project config, including the D1 binding.

## Troubleshooting

- **"D1 database not bound" error on the page**: the `DB` binding isn't set up.
  Check `wrangler.toml` has your real `database_id`, and/or check the binding
  exists under the Pages project's Settings → Functions in the dashboard.
- **Empty member/task lists after a fresh deploy**: make sure you ran the
  `wrangler d1 execute ... --file=./schema.sql` step against the `--remote`
  database, not just locally.
