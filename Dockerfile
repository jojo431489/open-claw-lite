FROM node:22-slim

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy source
COPY . .

# Build
RUN npm run build

# Create data directory
RUN mkdir -p data

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
