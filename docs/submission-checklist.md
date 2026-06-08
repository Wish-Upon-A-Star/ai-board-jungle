# Submission Checklist

Run these checks before final submission or when the UI changes:

Serverless checks can run without starting FastAPI, Vite, or Chrome CDP. Server-required checks are covered by `npm run verify:postgres`, `npm run verify:full:quick`, `npm run verify:fastapi`, `npm run verify:external-serve`, and live integration tests.

Run server-required checks sequentially. verify:postgres uses port 8140, verify:fastapi uses ports 8141/3141, verify:full:quick uses ports 8142/3142, and verify:external-serve uses port 8131; these checks must not stop the current 3000/8000 server.

Do not stop a currently shared server for ad-hoc fixes; first verify changes on a separate test port.

Safe local verification order:

```powershell
npm run verify:readiness
npm run verify:command-scope
npm run verify:readme-output
npm run verify:postgres
npm run verify:fastapi
npm run verify:full:quick
```

1. Refresh the demo screenshot when the visible dashboard changes.

   ```powershell
   $env:PYTHONPATH="backend"
   $env:AI_BOARD_DATABASE_URL="postgresql://ai_board:ai_board@localhost:5432/ai_board"
   python scripts/seed-fastapi.py
   npm run dev
   npm run demo:screenshot
   ```

2. Verify README structure, required feature evidence, and the screenshot PNG header.

   ```powershell
   npm run verify:hygiene
   npm run verify:text
   npm run verify:text-output
   npm run verify:frontend-helpers
   npm run verify:template-presets
   npm run verify:network-config
   npm run verify:evaluation-reports
   npm run verify:readiness
   npm run verify:readiness:compact
   npm run verify:readiness-output
   npm run verify:readiness-output-fixture
   npm run verify:command-scope
   npm run verify:readme
   npm run verify:readme-output
   ```

3. Run the full local smoke path without reinstalling dependencies.

   ```powershell
   npm run verify:production-serve
   npm run verify:external-serve
   npm run verify:full:quick
   npm run smoke:http
   npm run smoke:ui
   ```

   This includes `npm run verify:frontend-helpers`, `npm run verify:network-config`, and `npm run verify:evaluation-reports` before the build, then `npm run verify:production-serve` for single-process FastAPI static serving, `npm run verify:external-serve` for the separate external test-port path, and `npm run verify:contract` after the managed FastAPI and React servers are available.

4. For live external writes, set real GitHub/Notion/Google Calendar/Figma credentials in `.env` and run:

   ```powershell
   npm run test:live-integrations
   ```

Expected final artifacts:

- `README.md`
- `docs/demo-screenshot.png`
- `docs/evaluation-reports`
- Source code under `frontend`, `backend`, and `scripts`
