# ============================================================
# Stage 1 — Build do frontend (React/Vite)
# ============================================================
FROM node:20-alpine AS frontend-builder

WORKDIR /build
COPY frontend/package*.json ./
RUN npm install

COPY frontend/ ./
RUN npm run build
# Resultado: /build/dist/index.html + /build/dist/assets/*

# ============================================================
# Stage 2 — Backend Node + arquivos estáticos do frontend
# ============================================================
FROM node:20-alpine

WORKDIR /app

# Dependências nativas + timezone data
RUN apk add --no-cache python3 make g++ tzdata
ENV TZ=America/Sao_Paulo

# Instala deps do backend (só production)
COPY backend/package*.json ./
RUN npm install --production

# Copia código do backend
COPY backend/src ./src

# Copia o build do frontend para ser servido pelo Express
COPY --from=frontend-builder /build/dist ./public

# Data directory (será montado como volume em runtime)
RUN mkdir -p /app/data

EXPOSE 3001

CMD ["node", "src/index.js"]
