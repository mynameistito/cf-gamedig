FROM oven/bun:1.3.14-slim

WORKDIR /fixture

COPY quake3-fixture.ts ./

EXPOSE 27960/udp

CMD ["bun", "quake3-fixture.ts"]
