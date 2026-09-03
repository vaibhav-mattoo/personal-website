---
title: Fixture A
date: 2026-01-01
summary: Exercises wikilinks, an alias, an anchor link, and a broken link.
tags: [fixture]
relations:
  - type: cites
    target: fixture-c
---

This links normally to [[fixture-b]], and with a custom label to
[[fixture-b|the second fixture]].

It also references [[fb-alias]], which should resolve via fixture-b's alias.

Here's a heading-anchor form: [[fixture-c#a-heading]].

This one is intentionally broken: [[does-not-exist]].

A wikilink-looking string inside code should be ignored:

```
[[fixture-b]]
```

And inline: `[[fixture-b]]` should also be ignored.
