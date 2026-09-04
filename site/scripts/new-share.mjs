#!/usr/bin/env node
// `npm run new-share` — prints a fresh share token. Paste it into a note's
// frontmatter as `share: <token>` to publish it at /s/<token>/ (see
// site/src/pages/s/[token].astro and docs/sharing.md). Optionally add
// `shareUntil: <date>` to that same note — past that date the page stops
// being built.
//
// crypto.randomBytes(16) is 128 bits of entropy; hex-encoded that's exactly
// the 32-char token content.config.ts's schema requires.

import { randomBytes } from 'node:crypto';

console.log(randomBytes(16).toString('hex'));
