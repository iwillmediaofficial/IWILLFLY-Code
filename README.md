# IWILLFLY

Mobile-first PWA for local offers, malls and daily Scratch & Win, with Customer, Vendor and Admin areas.
Phase 0 (Foundation) of the [development plan](https://claude.ai/code/artifact/3df944ee-c41f-444f-835d-f837ba7cdaa4).

Stack (all free tiers): React + TypeScript + Vite PWA, Tailwind CSS v4, Supabase (Postgres, Auth, RLS),
Cloudflare Pages (hosting + one Pages Function), Cloudflare R2 (images), GitHub Actions (CI + nightly backup).

## Design

Colours, font and component styles come 1:1 from the approved prototype (`iwillfly-ui-demo/styles.css`).
They live in `src/styles/index.css`:

| Token                | Value                                | Tailwind class examples |
| -------------------- | ------------------------------------ | ----------------------- |
| blue                 | `#1760d9`                            | `bg-blue`, `text-blue`  |
| blue2                | `#0b4fca`                            | `bg-blue2`              |
| yellow               | `#ffdc16`                            | `bg-yellow`             |
| ink                  | `#17243f`                            | `text-ink`              |
| muted                | `#6f7c91`                            | `text-muted`            |
| bg                   | `#f4f7fb`                            | `bg-bg`                 |
| green / red / orange | `#16b85a` / `#ef3b43` / `#ff8a21`    | `bg-green`, `text-red`  |
| line                 | `#e6ebf2`                            | `border-line`           |
| font                 | Inter (self-hosted, weights 400–900) | `font-sans`             |

Tailwind's default colour palette is switched off, so only brand colours can be used. The prototype's
class names (`topbar`, `scratch-btn`, `shop-card`, `bottom-nav`, …) are kept as component classes.

## Project layout

```
src/
  customer/      Home, Explore, Scratch, Malls, Shop, Saved, Profile  (route /)
  vendor/        vendor dashboard                                    (route /vendor, role vendor)
  admin/         admin dashboard                                     (route /admin, admin roles)
  auth/          Supabase session + roles, login (email code + Google), role guard
  components/    shared UI ported from the prototype
  lib/           Supabase client, R2 upload helper
functions/api/upload-url.ts   Pages Function: checks the Supabase login and role, returns a 5-minute R2 upload URL
supabase/migrations/          database schema (profiles, user_roles, locations, categories + RLS)
supabase/tests/rls_test.sql   RLS checks for customer / vendor / admin / anonymous
.github/workflows/            ci.yml (lint + build on pull requests), backup.yml (nightly pg_dump to R2)
```

Shop and offer content is still the prototype's sample data (`src/data/demo.ts`); Phase 1 replaces it with
Supabase tables. Scratch & Win still runs on the device; Phase 2 moves it to the `play_scratch()` database function.

## Run locally

```bash
npm install
cp .env.example .env.local      # fill in the Supabase anon key and media URL
npm run dev                     # http://localhost:5173
```

To test uploads locally, copy `.dev.vars.example` to `.dev.vars`, fill it in, then
`npm run build && npx wrangler pages dev dist`.

## One-time setup

1. **Supabase**: apply `supabase/migrations/*.sql` (Supabase CLI `supabase db push`, or paste into the SQL editor).
   Then in Authentication > Providers enable Email and Google, and in Authentication > URL Configuration add
   your site URL and `https://<your-domain>/login` as a redirect URL. To show a 6-digit code in the login email,
   add `{{ .Token }}` to the Magic Link email template.
2. **First admin**: sign in once, then run in the SQL editor:
   `insert into public.user_roles (user_id, role) select id, 'super_admin' from auth.users where email = 'you@example.com';`
3. **Cloudflare R2**: follow the R2 setup guide (buckets, CORS, API token).
4. **Cloudflare Pages**: Workers & Pages > Create > Pages > Connect to Git, pick this repo.
   Build command `npm run build`, output directory `dist`. Add variables `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY`, `VITE_MEDIA_BASE_URL`, `R2_ACCOUNT_ID`, `R2_BUCKET`, and secrets
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
5. **GitHub secrets** for the backup: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `SUPABASE_DB_URL`.

## Checks

```bash
npm run lint && npm run format:check && npm run build
# RLS tests, against a local Supabase only:
supabase start && supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql
```

Phase 0 gate: a customer, a vendor and an admin can each sign in on a preview URL and only see their own area,
and the RLS tests pass.
