# =============================================
# Chess Platform - Multi-Stage Dockerfile
# =============================================
# Build:
#   docker build -f docker/Dockerfile -t chess-platform .
#
# Stages:
#   1. deps       - Install production dependencies
#   2. builder    - Install all dependencies, compile TypeScript
#   3. production - Minimal image with compiled app
# =============================================

# =============================================
# Stage 1: Dependencies
# =============================================
FROM node:20-slim AS deps
WORKDIR /app

# Install build tools for native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files
COPY package*.json ./
COPY prisma ./prisma/

# Install production dependencies only
RUN npm ci --only=production && npm cache clean --force

# Generate Prisma client
RUN npx prisma generate

# =============================================
# Stage 2: Builder
# =============================================
FROM node:20-slim AS builder
WORKDIR /app

# Install build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files
COPY package*.json ./
COPY prisma ./prisma/
COPY tsconfig*.json ./
COPY nest-cli.json ./

# Install all dependencies (including devDependencies)
RUN npm ci && npm cache clean --force

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY src ./src/
COPY scripts ./scripts/

# Build application
RUN npm run build

# Remove devDependencies after build
RUN npm prune --production

# =============================================
# Stage 3: Production
# =============================================
FROM node:20-alpine AS production
WORKDIR /app

# Metadata
LABEL maintainer="chess-platform-team"
LABEL description="Chess Platform - Generic Board Game Framework"
LABEL version="1.0.0"

# Install required packages
RUN apk add --no-cache \
    curl \
    ca-certificates \
    dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy production dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma

# Copy compiled application from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Copy necessary config files
COPY --from=builder /app/tsconfig.json ./

# Generate Prisma client for production
RUN npx prisma generate

# Set correct permissions
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Environment
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Start application
CMD ["node", "dist/main"]
