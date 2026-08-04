# Beam Stock Management V2 — Master Edition Specification (Multi-Tenant)

**Purpose of this document:** a complete, self-contained functional and
technical specification for the **V2, multi-tenant** ("MasterBeamBuild-V2")
edition of Beam Stock Management — one root administrator overseeing any
number of independent sister companies, each with its own login, users,
lookups, and branding, and each with data entry split into separate
**Inward** and **Outward** transactions supporting partial/split shipments.
Written so that any AI coding tool or developer can build it from scratch
without needing to see the original source code or any companion document.

This supersedes the V1 master spec (`beam-stock-master-spec.md`), which
described a single mutable record with inward and outward fields on the
same row. If you specifically need that simpler V1 shape, refer to that
document instead — it is not compatible with this one and the two should
not be mixed.

If you only ever need a single company with no sister companies, the
`beam-stock-standalone-spec-v2.md` document describes a lighter-weight V2
edition better suited to that case — this document does not depend on it.

---

## 1. Product Overview

A web application for a group of sister companies to each track beam pipes
moving in and out of stock, modeled as two linked transaction types, run
once for the whole group instead of once per company:

- An **Inward entry** — one row per batch of pipes received (from whom,
  how many, when, on which vehicle), belonging to exactly one company.
- One or more **Outward shipments** against that entry — each shipment
  records some quantity leaving, on some date, on some vehicle. Because
  shipments are **often split across multiple trips**, an Inward entry can
  have any number of Outward shipments recorded against it over time. The
  entry is considered fully shipped once its shipments' quantities add up
  to the quantity that came in.

Three kinds of users:
- **Root** (exactly one account, system-wide) creates and manages sister
  companies and has full oversight of all of them, but does no day-to-day
  data entry itself.
- **Company admins** manage everything within their own company: users,
  configuration, reporting, housekeeping, branding, and can edit/delete
  Inward entries and individual Outward shipments — with zero visibility
  into any other company.
- **Employees** create Inward entries and record Outward shipments against
  open entries, within their own company only.

Must run unmodified on desktop, tablet, and phone browsers, with no app
install required (though "Add to Home Screen" is supported).

---

## 2. Tech Stack

- **Backend**: Node.js + Express
- **Database**: SQLite via `better-sqlite3` — one shared file across every
  company, zero external configuration, free. Do not substitute a hosted
  database unless the person explicitly asks — see §14 for why this
  choice was made and its trade-offs.
- **Auth**: `express-session` + `connect-sqlite3` (so sessions survive
  server restarts) + `bcryptjs` (pure JS, no native compilation needed)
  for password hashing.
- **Frontend**: Plain HTML/CSS/vanilla JavaScript single-page app, served
  as static files by the same Express app. No build step, no frontend
  framework. All data access via `fetch()` calls to a `/api/...` REST API
  on the same origin.
- **File uploads**: `multer` (memory storage) + `sharp` for server-side
  image resizing before writing to disk. Both Inward entries and
  individual Outward shipments can each carry their own optional photo.
- **Email**: `nodemailer`, configured against the operator's own SMTP
  account (Gmail app-password is the standard recommendation — free, no
  third-party signup).
- **Scheduled jobs**: `node-cron` — two independent weekly schedules (see
  §6.9–§6.10).
- **PWA basics**: `manifest.json` + a minimal service worker that caches
  only the static app shell (HTML/CSS/JS), never API responses.

---

... (full spec pasted as provided by the user) ...
