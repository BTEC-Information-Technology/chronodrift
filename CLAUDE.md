# Chrono Drift: notes for coding agents

- Public repository. Everything committed here is English: code, comments, docs, commit messages.
- Start with `README.md` (current state, test values, next steps) and `docs/DEVELOPMENT-PLAN.md`.
- Bump `BUILD` in `src/main.ts` on every change that reaches the player; it is shown on the
  start screen so a phone test can confirm the new code loaded.
- Game logic lives in logical lane space; models, curvature and era palettes are visual only.
- Cloudflare Workers Builds deploys on push to `main` (`npm run build`, `npx wrangler deploy`);
  do not deploy from an agent session unless asked. Never commit tokens.
- Commands: `npm run dev` (`-- --host` for LAN testing), `npm run build`, `npm run test`.
- This repo may be checked out as a git submodule inside a private parent repo. Work on the
  `main` branch inside the submodule, push here first, then update the pointer in the parent.
