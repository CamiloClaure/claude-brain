---
brain: session
topics: [P.acmeshop]
updated: 2026-01-15
---
Task: move acme-shop auth to cookies.
Decisions: cookie sessions over JWT (SSR needs the user on first render).
Open: CSRF token rotation.
Next: write middleware test.
