# Build
FROM node:22-slim AS build
WORKDIR /app
# better-sqlite3 compiles a native addon if no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Run
FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production
ENV AGENDA_DB_PATH=/data/agenda.db
# Where the SQLite file lives — mount a persistent volume here or the
# household's data disappears on every redeploy.
VOLUME /data

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# standalone tracing leaves out the native .node binary; bring it along.
COPY --from=build /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3

EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
