# Project Rules And Lessons

This file records recurring rules for the AI Companion project so future work does not repeat old mistakes.

## Engineering Rules

- Inspect before editing. Use targeted file reads and `rg`.
- Keep edits scoped to the requested subsystem.
- Do not revert user-owned changes unless explicitly asked.
- Run `npm run build` and `npm test -- --runInBand` after meaningful backend changes.
- Clean generated artifacts such as `tsconfig.build.tsbuildinfo` unless intentionally tracked.

## Documentation Rules

- When feature status changes, update:
  - `docs/Implementation_Plan.md`
  - `docs/Learning_Notes.md`
- Learning notes should include reasoning, data flow, pitfalls, verification, and next steps.
- Plan docs must not list completed work as unfinished.

## Docker Rules

- Docker service-to-service URLs use Compose service names:
  - Postgres: `postgres:5432`
  - Embedding: `http://embedding:8000`
- Do not use `localhost` inside containers for sibling services.
- Keep ONNX models mounted with `./python/models:/app/models:ro`; do not bake them into images.
- Keep secrets in `.env.docker`, not committed files.
- Validate with `docker compose --env-file .env.docker.example -f docker-compose.yml config`.

## Windows / Encoding Rules

- PowerShell may display Chinese comments as mojibake. Do not rewrite comments only because terminal output looks wrong.
- Avoid fragile exact multi-line replacements when files may have odd line endings or encoding.
- Prefer ASCII test fixtures unless Chinese text behavior is the thing being tested.

## WeChat Rules

- Official WeChat backup is not readable text export.
- Do not decrypt or crack WeChat databases.
- Use the safe clipboard/current-window export tool under `tools/`.
- Keep `exports/` ignored.

## Cloud Purchase Rules

- Buy only what maps to current needs.
- For this project, prioritize CPU/RAM over add-ons.
- Use free/automated HTTPS first; do not buy paid SSL by default.
- Add object storage, CDN, and CLS only after real usage needs appear.
