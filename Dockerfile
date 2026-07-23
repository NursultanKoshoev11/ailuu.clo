FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache tini \
  && addgroup -S ailuu \
  && adduser -S -G ailuu -h /app ailuu
COPY --from=dependencies /app/node_modules ./node_modules
COPY --chown=ailuu:ailuu package.json ./
COPY --chown=ailuu:ailuu src ./src
COPY --chown=ailuu:ailuu scripts ./scripts
COPY --chown=ailuu:ailuu migrations ./migrations
COPY --chown=ailuu:ailuu public ./public
COPY --chown=ailuu:ailuu data/store.seed.json ./data/store.seed.json
RUN mkdir -p /app/data/uploads && chown -R ailuu:ailuu /app/data
USER ailuu
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
