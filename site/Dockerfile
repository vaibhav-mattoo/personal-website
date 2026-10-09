# Build static site (Astro + Pagefind) from repo root workspace, serve with Caddy.
# The `builder` stage is also used by `deploy/update.sh --local-build`.
FROM node:22-alpine AS builder

RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY package.json package-lock.json ./
COPY site/package.json site/package.json

RUN npm ci --omit=dev

ARG PUBLIC_SITE_NAME=vmattoo.dev
ARG PUBLIC_WALINE_SERVER_URL=
ENV PUBLIC_WALINE_SERVER_URL=$PUBLIC_WALINE_SERVER_URL
COPY .env.example .env
RUN sed -i "s/^PUBLIC_SITE_NAME=.*/PUBLIC_SITE_NAME=${PUBLIC_SITE_NAME}/" .env \
	&& if [ -n "${PUBLIC_WALINE_SERVER_URL}" ]; then \
		sed -i "s|^PUBLIC_WALINE_SERVER_URL=.*|PUBLIC_WALINE_SERVER_URL=${PUBLIC_WALINE_SERVER_URL}|" .env; \
	fi
COPY site site

RUN npm run build -w site

FROM caddy:2-builder AS caddy

RUN xcaddy build --with github.com/mholt/caddy-ratelimit

# Caddy only, no site baked in. Production builds this target: CI builds the
# site and uploads it to the VM, where it's bind-mounted (see
# docker-compose.prod.yml and deploy/update.sh), so a notes update doesn't
# rebuild this image — and BuildKit skips the `builder` stage entirely.
FROM caddy:2-alpine AS server

COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 80 443

# Default (local `docker compose up`): the same server with the site baked in.
FROM server

COPY --from=builder /app/site/dist /srv
