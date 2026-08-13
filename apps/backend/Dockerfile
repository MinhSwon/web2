FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
RUN npm install --workspace @saas-video/backend --include-workspace-root
COPY apps/backend apps/backend
RUN npm run build -w @saas-video/backend

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
RUN npm install --omit=dev --workspace @saas-video/backend --include-workspace-root
COPY --from=build /app/apps/backend/dist apps/backend/dist
COPY apps/backend/migrations apps/backend/migrations
CMD ["node", "apps/backend/dist/server.js"]

