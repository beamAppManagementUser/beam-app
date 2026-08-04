# Spec Compliance Report — Beam Stock Management V2 (mapping against current code)

Branch: fix/secure-backups-auth-sessions
Date: 2026-08-04

Summary
-------
This report maps the major functional and technical requirements from the
provided spec (Beam Stock Management V2 — Master Edition) to the current
implementation on branch `fix/secure-backups-auth-sessions` of the
`beam-app` repository. Status keys: IMPLEMENTED / PARTIAL / MISSING.

High-level status
-----------------
- Authentication (login/logout/me, sessions, lockout): PARTIAL -> core
  login/logout/me and session storage implemented; lockout and failed
  attempts flow implemented in auth.js.
- Sessions & cookies: IMPLEMENTED -> central session middleware added,
  SameSite handling and TTL present; cross-origin SameSite=None handled
  when ALLOWED_ORIGINS is set.
- System backups endpoints: PARTIAL -> /api/backups list/download/run
  scaffolding and defensive routes added; company backups endpoints not
  fully implemented yet.
- Frontend SPA: PARTIAL -> interactive preview page added at
  public/public.html with login/logout and backups listing wired to API.
  Full SPA (Inward/Outward/All Records/etc.) not yet implemented.
- Companies, Users, Inward, Outward, Lookups, Reports, Housekeeping:
  MISSING/PARTIAL -> core data model and many routes still need
  implementation or full hardening and tests.
- File uploads (photos): MISSING -> Worker/D1-based approach differs from
  multer/sharp; photo handling needs implementation using Workers APIs
  and an object store if large files are required.
- Scheduled jobs: PARTIAL -> scheduled export hooks present in server.js;
  mapping from node-cron to Workers scheduled event implemented via
  scheduled export. Ensure job idempotency.

Detailed mapping (selected sections)
-----------------------------------
1) Auth (Spec §6.1, §8)
- POST /api/auth/login: PARTIAL — implemented in src/routes/auth.js with
  case-insensitive lookup and async bcrypt compare. Lockout and
  failed-attempts handling present.
- POST /api/auth/logout: IMPLEMENTED — destroy session and clear cookie.
- GET /api/auth/me: IMPLEMENTED — returns session user shape.
- Recovery endpoints: PARTIAL — endpoints present; review required for
  edge cases and tests.
Files: src/routes/auth.js, src/middleware/session.js

2) Sessions & Cookies (Spec §6.1)
- Session creation, TTL, expiry: IMPLEMENTED in src/middleware/session.js
- Cross-origin cookie flags: IMPLEMENTED (SameSite=None when
  ALLOWED_ORIGINS set).
Files: src/middleware/session.js

3) Backups (Spec §6.9–§6.10, §8 backups endpoints)
- GET /api/backups: PARTIAL — listing implemented
- GET /api/backups/:filename/download: PARTIAL — implemented and
  defensive for large blobs
- POST /api/backups/run: PARTIAL — route scaffolded; actual backing up of
  the underlying D1 DB file vs system file copy needs confirmation for
  Workers/D1 environment.
- Company backups endpoints: MISSING — per-company JSON export logic and
  storage paths need implementation (move large exports to R2 recommended).
Files: src/services/backup.js, src/routes/backups.js

4) Companies / Users / Inward / Outward / Lookups / Reports / Housekeeping
- Most are MISSING or PARTIAL: routes exist in repo but many are not
  hardened with input validation or complete CRUD logic. Key missing
  areas include:
  - Company create/delete lifecycle with explicit shipments deletion step
  - Inward CRUD with shipped-quantity floor validation
  - Outward create/edit/delete with remaining-balance checks
  - Lookup fields CRUD with per-company seeding
Files to implement/verify: src/routes/companies.js, users.js,
inward.js, outward.js, lookups.js, reports.js, housekeeping.js

5) Data model vs D1
- The spec assumes SQLite schema. The repo uses D1 (SQLite-compatible)
  but schema migrations need to implement exact tables/columns in spec.
  I added migrations/0003_add_indexes.sql earlier; verify schema creation
  scripts include full tables per spec §5.
Files: migrations/*.sql

6) File uploads & photos
- MISSING for Workers: implement using R2 (recommended) and multipart
  parsing in Workers environment (FormData available on fetch)

7) Frontend (Spec §9)
- public/public.html: IMPLEMENTED (preview + login + backups listing)
- Full SPA (Inward/Outward/All Records/Ship Out/View Shipments/etc):
  MISSING — the provided sampleUX has been added as an interactive HTML
  preview; convert to full SPA views as next task.
Files: public/public.html

8) Differences & platform notes
- Stack difference: Spec expects Express + better-sqlite3 + multer +
  node-cron; repo uses Hono/Cloudflare Workers + D1 + ASSETS/R2. I will
  keep the Workers stack and adapt spec requirements to it; note where
  platform constraints require alternate implementations.

Next steps & recommended backlog
--------------------------------
1) Implement company CRUD and ensure deletion order (delete shipments
   first, then companies). (ETA: medium)
2) Implement per-company JSON exports and storage in R2; add company
   backups endpoints. (ETA: medium)
3) Implement Inward/Outward CRUD with full validation and unit tests.
   (ETA: medium-high)
4) Add multipart upload handling for photos and store them in R2.
   (ETA: medium)
5) Expand frontend into the full SPA: Inward, Outward, All Records,
   Reports, Lookups, Users, Companies, Housekeeping, Backups. (ETA:
   medium-high)
6) Add production-grade rate limiter (Durable Object or KV) and
   additional monitoring for auth/backups errors. (ETA: medium)

I will attach/commit this report, the spec, and the interactive UI to
branch `fix/secure-backups-auth-sessions` as requested.

