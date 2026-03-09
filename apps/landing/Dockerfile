FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install --production

# Copy server
COPY server.js ./

# Copy static site into public/
RUN mkdir -p public
COPY index.html public/
COPY thesis.html public/
COPY style.css public/
COPY script.js public/
COPY iconfigwork.png public/
COPY robots.txt public/
COPY sitemap.xml public/

# Railway injects PORT
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
