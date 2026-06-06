# Submission Checklist

Run these checks before final submission or when the UI changes:

1. Refresh the demo screenshot when the visible dashboard changes.

   ```powershell
   $env:PYTHONPATH="backend"
   $env:AI_BOARD_DATABASE_URL="sqlite:///./data/screenshot-verify.db"
   python scripts/seed-fastapi.py
   npm run dev
   npm run demo:screenshot
   ```

2. Verify README structure, required feature evidence, and the screenshot PNG header.

   ```powershell
   npm run verify:readme
   ```

3. Run the full local smoke path without reinstalling dependencies.

   ```powershell
   npm run verify:full:quick
   ```

4. For live external writes, set real GitHub/Notion/Google Calendar/Figma credentials in `.env` and run:

   ```powershell
   npm run test:live-integrations
   ```

Expected final artifacts:

- `README.md`
- `docs/demo-screenshot.png`
- `docs/evaluation-reports`
- Source code under `frontend`, `backend`, and `scripts`
