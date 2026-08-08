Deployment and migration instructions

Required repository secrets (add in Settings → Secrets):

- CLOUDFLARE_API_TOKEN: token with permissions to deploy Workers and manage D1 (if migrations will be run from CI).
- CF_ACCOUNT_ID: Cloudflare account id (if used in wrangler config).
- NETLIFY_AUTH_TOKEN: Netlify personal access token for deploys.
- NETLIFY_SITE_ID: Netlify site id (for the site to deploy).

Cloudflare workflow
- The Cloudflare workflow (cloudflare-deploy.yml) runs automatically on push to main.
- It runs lint and tests (non-blocking — failures will not stop the deploy step by default in this config).
- A separate manual job exists for running D1 migrations. To run migrations from the Actions UI:
  1. Open the workflow in GitHub Actions.
  2. Click "Run workflow" on the Cloudflare Deploy workflow and start the `migrate-d1` job.
  3. The migration command in the workflow is a placeholder; update it to the desired command (e.g., wrangler d1 execute) before running.

Netlify workflow
- The Netlify workflow (netlify-deploy.yml) runs automatically on push to main and deploys the contents of the `public/` directory by default.
- If your frontend requires a build step, add a `build` script to package.json and the workflow will run `npm run build` automatically.

Migrations (recommended manual)
- By default, migrations are NOT run automatically against production. Use the manual `migrate-d1` job to run migrations after reviewing changes.
- Example migration command (update before running):
  npx wrangler d1 execute --binding="DB" --file=./migrations/0001_init.sql

If you want me to automatically run migrations on deploy, I can update the workflow, but I recommend keeping migrations manual to avoid accidental production changes.
