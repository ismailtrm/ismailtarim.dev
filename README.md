# ismailtarim.dev

Personal site of İsmail Tarım: field notes on problems that are not documented elsewhere, projects and essays.

## How it works

- One Cloudflare Worker ([Hono](https://hono.dev) + `hono/jsx`) renders every page per request from **D1**.
- Images live in **R2**. CSS, fonts and the favicon are static assets served before the Worker runs.
- Markdown is turned into HTML **once, in the admin panel's browser**, and stored next to the Markdown. The Worker only puts stored HTML into templates, which keeps each request well under the Workers Free CPU limit (10 ms).
- Pages carry `Cache-Control: max-age=PAGE_CACHE_SECONDS`, so a publish shows up within that window.
- `/rss.xml`, `/sitemap.xml` and `/llms.txt` are generated from D1 on request.
- Old URLs keep working: a slug change records a row in `redirects` and the Worker answers with a 301.

Planned: the admin panel under `/admin` (Preact, behind Cloudflare Access), nightly D1 exports to R2.
Design decisions: [`docs/DESIGN.md`](docs/DESIGN.md).

## Develop

```sh
bun install
bun run db:migrate:local      # create the local D1 schema
bun run dev                   # http://localhost:8787
bun run typecheck && bun run test
```

## Deploy

```sh
bunx wrangler d1 create ismailtarim-db      # once; put the id in wrangler.jsonc
bun run db:migrate:remote
bun run deploy
```

Secrets are set with `wrangler secret put` and never committed.
