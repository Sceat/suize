# syntax=docker/dockerfile:1.7

# ---------- Stage 1 — build the Vite SPA ----------
FROM node:22-alpine AS build
WORKDIR /app

# Install deps with cached layer; copy package files first for cache friendliness.
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ---------- Stage 2 — serve dist/ with unprivileged nginx ----------
FROM nginxinc/nginx-unprivileged:1.27-alpine
USER root

# Replace default nginx config with our SPA-friendly one
COPY --chown=101:101 nginx.conf /etc/nginx/conf.d/default.conf
RUN rm -f /etc/nginx/conf.d/default.conf.bak

# Copy built assets
COPY --from=build --chown=101:101 /app/dist /usr/share/nginx/html

USER 101
EXPOSE 8080

# nginx-unprivileged image already CMDs nginx in foreground.
