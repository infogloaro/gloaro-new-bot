# Multi-stage build. Used locally via docker compose and unchanged when this is
# pushed to ECR for the AWS deployment.

# ---- build ----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm install

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npx prisma generate && npm run build

# ---- runtime --------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# openssl is required by the Prisma query engine on alpine.
RUN apk add --no-cache openssl dumb-init

COPY package*.json ./
COPY prisma ./prisma
RUN npm install --omit=dev && npx prisma generate && npm cache clean --force

COPY --from=build /app/dist ./dist

# Never run as root.
RUN addgroup -S gloaro && adduser -S gloaro -G gloaro && chown -R gloaro:gloaro /app
USER gloaro

EXPOSE 3000

# The ALB target group points at this.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
# Migrations are applied at start so a new ECS task never runs against an old schema.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
