# ---- build stage ----------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Install dependencies first so the layer caches across source-only changes.
COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

# Reinstall without dev dependencies for the runtime image.
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime stage --------------------------------------------------------
FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

# tini gives us correct signal handling so SIGTERM reaches the Node process.
RUN apk add --no-cache tini

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
# Unicode font used by the PDF report renderer (Azerbaijani glyphs).
COPY --from=build /app/assets ./assets

EXPOSE 4000

# Run as a non-root user.
USER node

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
