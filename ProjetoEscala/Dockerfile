# ============================================================
# Stage 1 - Frontend build (React/Vite)
# ============================================================
FROM node:20-alpine AS frontend-builder

WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ============================================================
# Stage 2 - Backend Node + static frontend files
# ============================================================
FROM node:20-alpine

WORKDIR /app

# Native build deps for better-sqlite3 plus timezone data.
RUN apk add --no-cache python3 make g++ tzdata

ENV TZ=America/Sao_Paulo
ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/data/escala.db
ENV PUBLIC_DIR=/app/public

# Backend production dependencies.
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Backend source.
COPY backend/src ./src

# Frontend build served by Express.
COPY --from=frontend-builder /build/dist ./public

# Railway persistent volume should be mounted here.
RUN mkdir -p /data

EXPOSE 3001

CMD ["node", "src/index.js"]
