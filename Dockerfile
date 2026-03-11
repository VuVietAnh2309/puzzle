FROM node:20-slim AS build

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev && npm cache clean --force

COPY . .

FROM gcr.io/distroless/nodejs20-debian12:nonroot

LABEL maintainer="IDK"
LABEL description="Hardened Node.js Distroless Image"

WORKDIR /app

COPY --from=build --chown=nonroot:nonroot /app /app

USER nonroot

ENV NODE_ENV=production

EXPOSE 3000

ENTRYPOINT ["/nodejs/bin/node", "server.js"]