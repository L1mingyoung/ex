# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS api-deps
WORKDIR /app
COPY package*.json ./
RUN npm config set registry https://registry.npmmirror.com && npm ci

FROM node:24-bookworm-slim AS web-deps
WORKDIR /app/web
COPY web/package*.json ./
RUN npm config set registry https://registry.npmmirror.com && npm ci

FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY --from=api-deps /app/node_modules ./node_modules
COPY --from=web-deps /app/web/node_modules ./web/node_modules
COPY . .
RUN npm run build:web
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm config set registry https://registry.npmmirror.com && npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/web/dist ./web/dist
COPY --from=builder /app/adapters ./adapters
EXPOSE 3000
CMD ["node", "dist/main.js"]
