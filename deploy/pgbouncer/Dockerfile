FROM node:24-alpine

RUN apk add --no-cache pgbouncer postgresql-client && addgroup -S pooler && adduser -S -G pooler pooler
WORKDIR /opt/pooler
COPY deploy/pgbouncer/entry.mjs ./entry.mjs
RUN chown -R pooler:pooler /opt/pooler
USER pooler
CMD ["node", "entry.mjs"]
