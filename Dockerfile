FROM oven/bun:1.3.14-slim

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src/container ./src/container

ENV PORT=8080
EXPOSE 8080

CMD ["bun", "src/container/index.ts"]
