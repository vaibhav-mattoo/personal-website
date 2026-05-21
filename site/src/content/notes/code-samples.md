---
title: Code samples
date: 2025-03-18
summary: Syntax highlighting comes from Astro's built-in Shiki pipeline.
tags: [dev]
---

Fenced blocks are highlighted at build time:

```ts
export function greet(name: string) {
	return `hello, ${name}`;
}
```

Inline `code` works too. No extra highlighter setup required.
