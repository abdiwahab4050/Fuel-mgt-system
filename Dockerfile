# FuelFlow ERP — production image (API + static frontend in one container)
#
#   docker build -t fuelflow .
#   docker run --env-file backend/.env.production -p 4000:4000 fuelflow
#
# Migrations run on start (prisma migrate deploy), then the server starts.

# ---- build the Tailwind stylesheets ----
FROM node:20-alpine AS css
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build:css

# ---- install dependencies + generate the Prisma client ----
# (the prisma CLI stays installed: it runs `migrate deploy` on every start)
FROM node:20-alpine AS deps
WORKDIR /app/backend
RUN apk add --no-cache openssl
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY backend/prisma ./prisma
RUN npx prisma generate

# ---- runtime ----
FROM node:20-alpine
RUN apk add --no-cache openssl tini
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=deps /app/backend/node_modules ./backend/node_modules
COPY backend/package.json ./backend/
COPY backend/prisma ./backend/prisma
COPY backend/src ./backend/src
COPY --from=css /app/frontend/ ./frontend/
RUN rm -rf ./frontend/node_modules ./frontend/build && chown -R node:node /app
USER node
WORKDIR /app/backend
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
