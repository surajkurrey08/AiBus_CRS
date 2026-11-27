# Update these verified multi-platform digests through a reviewed PR.
FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
COPY admin/package.json admin/package.json
COPY partner/package.json partner/package.json
RUN npm ci --no-audit --no-fund

FROM dependencies AS build
COPY frontend frontend
COPY backend backend
COPY admin admin
COPY partner partner
COPY integrations integrations
COPY scripts scripts
RUN npm run build

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev --no-audit --no-fund

# Car CRS is deliberately built in its own dependency boundary.  It is not a
# root workspace because it must be deployable without the Bus CRS runtime.
FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8 AS car-dependencies
WORKDIR /app/car-crs
COPY car-crs/package.json car-crs/package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM car-dependencies AS car-build
COPY car-crs ./
RUN npm run build

FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8 AS car-sandbox-api
ARG REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/surajkurrey08/AiBus_CRS" org.opencontainers.image.revision=$REVISION
WORKDIR /app/car-crs
COPY --from=car-dependencies /app/car-crs/node_modules ./node_modules
COPY --from=car-build /app/car-crs/dist ./dist
COPY --from=car-build /app/car-crs/src/docs ./dist/docs
COPY car-crs/package.json ./package.json
USER node
EXPOSE 4010
HEALTHCHECK --interval=15s --timeout=6s --start-period=35s --retries=8 CMD node -e "fetch('http://127.0.0.1:4010/health/ready',{signal:AbortSignal.timeout(4500)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]

FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8 AS api
ARG REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/surajkurrey08/AiBus_CRS" org.opencontainers.image.revision=$REVISION
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY backend/package.json ./backend/package.json
RUN mkdir -p /app/backend/var/uploads && chown -R node:node /app/backend/var
WORKDIR /app/backend
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=6s --start-period=30s --retries=8 CMD node -e "fetch('http://127.0.0.1:4000/health/ready',{signal:AbortSignal.timeout(4500)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]

FROM nginx:stable-alpine@sha256:3bc3836dc0be3b811f238210360bf8e7ca8a2d0effdae46160bf1f3578710051 AS web-production
ARG REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/surajkurrey08/AiBus_CRS" org.opencontainers.image.revision=$REVISION
COPY deploy/nginx/gateway.conf /etc/nginx/conf.d/default.conf
COPY deploy/nginx/proxy.inc /etc/nginx/bookmybus-proxy.inc
COPY deploy/nginx/public-test-proxy.inc /etc/nginx/bookmybus-public-test-proxy.inc
COPY deploy/nginx/car-sandbox-proxy.inc /etc/nginx/bookmybus-car-sandbox-proxy.inc
COPY --from=build /app/frontend/dist /usr/share/nginx/operator
COPY --from=build /app/admin/dist /usr/share/nginx/admin
COPY --from=build /app/partner/dist /usr/share/nginx/partner
RUN printf '%s\n' "$REVISION" > /usr/share/nginx/revision.txt
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1:8080/gateway-health || exit 1

# Preserve the existing compose.yaml development web target and port mapping.
FROM nginx:stable-alpine@sha256:3bc3836dc0be3b811f238210360bf8e7ca8a2d0effdae46160bf1f3578710051 AS web
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
