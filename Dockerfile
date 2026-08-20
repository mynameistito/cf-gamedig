FROM oven/bun:1.3.14-slim

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile --production

COPY src/container ./src/container
COPY src/request-correlation.ts ./src/request-correlation.ts

ENV PORT=8080
EXPOSE 8080

CMD ["bun", "src/container/index.ts"]
