FROM node:22-alpine

WORKDIR /app
COPY . .
RUN mkdir -p /app/data/uploads && chown -R node:node /app/data

USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
