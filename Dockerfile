FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
COPY admin/package.json admin/package.json
RUN npm ci
COPY frontend frontend
COPY backend backend
COPY admin admin
COPY scripts scripts
RUN npm run build

FROM node:24-alpine AS api
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
COPY admin/package.json admin/package.json
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/backend/dist ./backend/dist
RUN mkdir -p /app/backend/var/uploads && chown -R node:node /app/backend/var
WORKDIR /app/backend
USER node
EXPOSE 4000
HEALTHCHECK --interval=20s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","dist/server.js"]

FROM nginx:stable-alpine AS web
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
