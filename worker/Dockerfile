# Official Playwright image — has Chromium + all system deps pre-installed
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm ci

# Build TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Only keep production deps after build
RUN npm prune --omit=dev

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
