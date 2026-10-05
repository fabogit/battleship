---
status: accepted
date: 2026-10-04
---

# ADR-0024: Preview origins

`ALLOWED_ORIGINS` accepts single-label wildcards (`https://*.<project>.pages.dev`) so Cloudflare Pages previews work without touching Render (implemented in #5).

## Considered options

* **Cloudflare Pages preview origins — manual list vs. CI automation vs. wildcard:** every preview commit gets a new `<hash>.<project>.pages.dev`; Render applies env var changes only on a new deploy. Pushing each preview origin to Render via its API would restart the single shared server (production included) on every branch push, need a Render API key in GitHub secrets, and grow the list forever. A manual list only covers stable branch aliases. A wildcard limited to one label under our own `pages.dev` project is safe, since only our project can publish there, and needs no redeploys (D24).

## Links

* Added on 2026-10-04 during the Phase 0 server spike ([#3](https://github.com/fabogit/battleship/issues/3)).
* Spec: [Development: Monorepo topology](../development.md#monorepo-topology) · [Deployment: Backend (Render)](../deployment.md#backend-render) · [Deployment: Frontend (Cloudflare Pages)](../deployment.md#frontend-cloudflare-pages)
* Issues: [#5](https://github.com/fabogit/battleship/issues/5)
