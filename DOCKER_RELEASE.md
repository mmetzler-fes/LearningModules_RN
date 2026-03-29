# Build/Release-Anleitung für Docker-Image (Server-Mode, ARM64/AMD64)

## Docker Build (Multi-Arch)

```sh
# Mit Buildx für ARM64 und AMD64:
docker buildx build --platform linux/amd64,linux/arm64 -t learningmodules-server:latest .
```

## Docker Run

```sh
docker run -p 3000:3000 -v $PWD/data:/app/data learningmodules-server:latest --server
```

- Das Image startet im reinen Server-Mode (ohne Electron-GUI)
- Daten werden im Host-Ordner ./data persistiert
- Port 3000 wird für Webzugriff und API freigegeben

## Hinweise
- Das Image ist für ARM64 (z.B. Raspberry Pi) und AMD64 geeignet
- Nur die für den Server-Modus nötigen Dateien werden kopiert
- Excel/CSV-Import funktioniert (node-gyp/Excel-Tools sind installiert)
