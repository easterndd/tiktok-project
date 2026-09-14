FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
RUN pnpm install --frozen-lockfile=false
COPY apps/api apps/api
COPY packages/shared-types packages/shared-types
RUN pnpm --filter @quickreels/shared-types build && pnpm --filter api db:generate && pnpm --filter api build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/packages/shared-types ./packages/shared-types
WORKDIR /app/apps/api
CMD ["node", "dist/server.js"]
