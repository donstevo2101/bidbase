FROM node:20-slim

WORKDIR /app

# Copy shared types first
COPY shared/ ./shared/

# Install server dependencies
COPY server/package*.json ./server/
COPY server/preload.js ./server/
RUN cd server && npm install

# Copy server source
COPY server/ ./server/

# Expose port (Railway sets PORT dynamically)
ENV NODE_ENV=production
EXPOSE 3001

# Use the exact command that works locally
WORKDIR /app/server
CMD ["node", "-r", "./preload.js", "-e", "require('tsx/cjs');require('./src/index.ts')"]
