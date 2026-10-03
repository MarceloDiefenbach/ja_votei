# build frontend
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN bun install
COPY . .
RUN bun run build

# runtime
FROM oven/bun:1
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps ./apps
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
CMD ["bun", "apps/api/src/index.ts"]
