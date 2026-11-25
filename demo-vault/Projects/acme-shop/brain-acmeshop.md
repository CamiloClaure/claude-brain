---
brain: P.acmeshop
---
# acme-shop (brain)
- Stack: Next.js + Postgres, deployed on Fly.io (2026-01-10)
- Auth: cookie sessions, not JWT; SSR must know the user on first render (2026-01-15)
- Gotcha: Fly volumes are per-region; run migrations from one machine only
