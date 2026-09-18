# Adopt Me Frost Value Scanner

A focused scanner that identifies Adopt Me pets from uploaded media and calculates totals only from verified imported value data.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

- Upload an inventory or trade screenshot, or a short video.
- Extract video frames in the browser and send them to the vision API.
- Identify distinct pets, variants, potions, confidence, and evidence frame.
- Flag uncertain detections for user correction before value lookup.
- Calculate Frost Value only when the value provider has a matching imported entry.

## Value catalog

The app intentionally does not scrape Elvebredd or invent values. The backend reads `artifacts/api-server/data/elvebredd-values.json`, or the path supplied by `ELVEBREDD_VALUES_PATH`. To validate and import an authorized JSON export:

`pnpm --filter @workspace/scripts run import:elvebredd -- <source.json>`

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
