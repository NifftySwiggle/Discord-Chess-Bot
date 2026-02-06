# Use the official Node.js 22 image
FROM node:22-slim

# Install system dependencies required by Playwright browsers
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    libgtk-4-1 libgraphene-1.0-0 libgstgl-1.0-0 libgstcodecparsers-1.0-0 \
    libmanette-0.2-0 libenchant-2-2 libsecret-1-0 libgles2 \
    fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 \
    libdrm2 libgbm1 libnspr4 libnss3 libxcomposite1 libxdamage1 libxrandr2 \
    xdg-utils wget ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci && npx playwright install

# Copy the rest of the application code
COPY . .

# Expose the port your app uses (adjust if needed)
EXPOSE 10000

# Start the bot
CMD ["npm", "start"]
