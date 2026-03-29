# Dockerfile für LearningModules Server-Mode (ARM64-kompatibel)
#
# Build: docker buildx build --platform linux/amd64,linux/arm64 -t learningmodules-server:latest .
# Run:   docker run -p 3000:3000 -v $PWD/data:/app/data learningmodules-server:latest --server

FROM node:20-slim

# System-Tools für node-gyp und Excel-Parsing
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Nur relevante Dateien kopieren (kein Electron, nur Server)
COPY package.json package-lock.json ./
COPY src/main ./src/main
COPY src/renderer ./src/renderer
COPY data ./data
COPY assets ./assets
COPY scripts ./scripts

RUN npm install --omit=dev && npm cache clean --force

# Expose Port
EXPOSE 3000

# Standardmäßig im Server-Mode starten (via Env-Var viel robuster für Docker-Compose)
ENV SERVER_MODE=true
ENV PORT=3000

# Startbefehl
CMD ["node", "src/main/main.js"]
