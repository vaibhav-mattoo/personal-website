# Build static site (Astro + Pagefind) from repo root workspace, serve with Caddy.
FROM node:22-alpine AS builder

RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY package.json package-lock.json ./
COPY site/package.json site/package.json

RUN npm ci --omit=dev

ARG PUBLIC_SITE_NAME=vmattoo.dev
COPY .env.example .env
RUN sed -i "s/^PUBLIC_SITE_NAME=.*/PUBLIC_SITE_NAME=${PUBLIC_SITE_NAME}/" .env
COPY site site

RUN npm run build -w site

FROM caddy:2-builder AS caddy

RUN xcaddy build --with github.com/mholt/caddy-ratelimit

FROM caddy:2-alpine

COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
COPY --from=builder /app/site/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 80 443
