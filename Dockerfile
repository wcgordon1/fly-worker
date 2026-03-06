# Playwright base image includes Chromium + required system dependencies,
# which makes deployment behavior more predictable on Fly.io.
FROM mcr.microsoft.com/playwright:v1.53.2-jammy

WORKDIR /app

# Install only production dependencies in container for a small MVP runtime.
# Using npm ci + lockfile keeps container installs deterministic.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY output/.gitkeep ./output/.gitkeep

ENV NODE_ENV=production
ENV PORT=8080
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

EXPOSE 8080

CMD ["npm", "start"]
