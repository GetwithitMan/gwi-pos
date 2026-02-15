# Standalone WebSocket server for GWI POS
# Runs Socket.io on its own process for maximum throughput.
#
# Build:
#   docker build -f docker/Dockerfile.ws -t gwi-pos-ws .
#
# Run:
#   docker run -p 3001:3001 gwi-pos-ws

FROM node:20-alpine

WORKDIR /app

# Copy package files and install production deps only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the compiled standalone server
COPY ws-server.js ./

# Default configuration
ENV WS_PORT=3001
ENV WS_HOSTNAME=0.0.0.0
ENV SOCKET_PATH=/ws
ENV NODE_ENV=production

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "ws-server.js"]
