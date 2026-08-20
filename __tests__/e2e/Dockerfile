FROM oven/bun:1.3.14-slim

WORKDIR /fixture

COPY fixtures/quake3-server.ts ./__tests__/fixtures/quake3-server.ts
COPY e2e/quake3-fixture.ts ./__tests__/e2e/quake3-fixture.ts

EXPOSE 27960/udp

CMD ["bun", "__tests__/e2e/quake3-fixture.ts"]
