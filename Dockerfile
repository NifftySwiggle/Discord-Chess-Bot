FROM mcr.microsoft.com/playwright:v1.42.1-jammy

# Set working directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the application code
COPY . .

# Start the bot
CMD ["npm", "start"]
