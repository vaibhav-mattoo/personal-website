---
title: Code copy test
date: 2026-05-21
summary: Verifies that fenced code blocks render with a copy button and follow light/dark mode.
tags: [meta]
---

A Python block:

```python
def greet(name: str) -> str:
    return f"hello, {name}"

print(greet("world"))
```

A shell block (expressive-code renders these in a terminal frame by default):

```bash
docker compose up -d
docker compose logs -f caddy
```

A TypeScript block with a filename, which expressive-code uses as the frame title:

```ts title="src/lib/theme.ts"
export function setMode(mode: 'light' | 'dark') {
  document.documentElement.dataset.mode = mode;
}
```
