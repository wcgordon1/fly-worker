# Playwright base image includes Chromium + required system dependencies,
# which makes deployment behavior more predictable on Fly.io.
FROM mcr.microsoft.com/playwright:v1.53.2-jammy

WORKDIR /app

# Install only production dependencies in container for a small MVP runtime.
COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY output/.gitkeep ./output/.gitkeep

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["npm", "start"]
