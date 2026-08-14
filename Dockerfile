# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim

ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="Quake III Arena WASM" \
      org.opencontainers.image.description="Assetless Quake III Arena browser checkpoint" \
      org.opencontainers.image.source="https://github.com/theodorecharles/quake3-wasm" \
      org.opencontainers.image.revision="$VCS_REF"

WORKDIR /opt/quake3
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY web ./web
COPY build/dedicated/ioq3ded ./build/dedicated/ioq3ded
COPY build/dedicated/baseq3 ./build/dedicated/baseq3
COPY docker/entrypoint.sh /usr/local/bin/quake3-entrypoint

RUN mkdir -p /tmp/quake3-runtime \
    && chmod 0755 /usr/local/bin/quake3-entrypoint /opt/quake3/build/dedicated/ioq3ded \
    && chown -R node:node /opt/quake3 /tmp/quake3-runtime

ENV Q3JS_HTTP_PORT=8088 \
    Q3JS_DED_PORT=27960 \
    Q3JS_DATA_ROOT=/data \
    Q3JS_RUNTIME_ROOT=/tmp/quake3-runtime \
    Q3JS_SLOTS=8 \
    Q3JS_BOTS=1 \
    KEEP_ALIVE=false \
    IDLE_TIMEOUT=15m

VOLUME ["/data"]
EXPOSE 8088/tcp 27960/udp
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8088/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

USER node
ENTRYPOINT ["/usr/local/bin/quake3-entrypoint"]
