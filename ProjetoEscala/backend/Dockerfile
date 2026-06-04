FROM node:20-alpine

WORKDIR /app

# Instala dependências nativas para better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install --production

COPY src ./src

EXPOSE 3001

CMD ["node", "src/index.js"]
