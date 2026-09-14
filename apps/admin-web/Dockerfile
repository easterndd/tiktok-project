FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/admin-web/package.json apps/admin-web/package.json
RUN pnpm install --frozen-lockfile=false
COPY apps/admin-web apps/admin-web
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm --filter admin-web build

FROM nginx:1.27-alpine
COPY apps/admin-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin-web/dist /usr/share/nginx/html
