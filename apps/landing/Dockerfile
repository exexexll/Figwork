FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache dumb-init wget

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 landing

COPY package.json package-lock.json ./
RUN npm ci --production

COPY server.js ./
RUN mkdir -p public
COPY index.html public/
COPY thesis.html public/
COPY style.css public/
COPY script.js public/
COPY iconfigwork.png public/
COPY figwork-logo-dark.png public/
COPY robots.txt public/
COPY sitemap.xml public/

ENV NODE_ENV=production
ENV PORT=8080

USER landing
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
