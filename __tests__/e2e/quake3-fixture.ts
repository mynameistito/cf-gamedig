import {
  QUAKE3_FIXTURE_PORT,
  startQuake3Fixture,
} from "../fixtures/quake3-server.ts";

const fixture = await startQuake3Fixture({
  host: "0.0.0.0",
  onExchange: (remoteAddress, remotePort) => {
    console.info(
      JSON.stringify({
        event: "quake3_fixture_exchange",
        remoteAddress,
        remotePort,
      })
    );
  },
  onUnexpectedPacket: (packetHex) => {
    console.error(
      JSON.stringify({
        event: "quake3_fixture_unexpected_packet",
        packetHex,
      })
    );
  },
  port: QUAKE3_FIXTURE_PORT,
});

console.info(
  JSON.stringify({
    event: "quake3_fixture_ready",
    port: fixture.port,
    protocol: "quake3",
    transport: "udp",
  })
);

const shutdown = async (): Promise<void> => {
  await fixture.close();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
