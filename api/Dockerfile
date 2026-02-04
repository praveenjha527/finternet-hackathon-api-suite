FROM node:20-alpine AS deps
WORKDIR /app

# Install dependencies (including dev for build)
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app

# Copy sources + already installed deps for build
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prisma client needs to be generated before build
RUN npx prisma generate --schema=prisma/schema.prisma
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Install only prod deps for runtime
COPY package*.json ./
RUN npm ci --omit=dev

# Copy Prisma schema + generated client
COPY prisma ./prisma
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/main.js"]
