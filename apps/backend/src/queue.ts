import amqp, { ChannelModel, ConfirmChannel } from "amqplib";
import { config } from "./config";

const QUEUE = "video.render.jobs";
let connection: ChannelModel | undefined;
let channel: ConfirmChannel | undefined;

async function connect(): Promise<ConfirmChannel> {
  const nextConnection = await amqp.connect(config.RABBITMQ_URL);
  connection = nextConnection;
  nextConnection.on("close", () => { connection = undefined; channel = undefined; });
  nextConnection.on("error", () => { connection = undefined; channel = undefined; });
  const nextChannel = await nextConnection.createConfirmChannel();
  channel = nextChannel;
  nextChannel.on("close", () => { channel = undefined; });
  nextChannel.on("error", () => { channel = undefined; });
  await nextChannel.assertQueue(QUEUE, { durable: true });
  return nextChannel;
}

export async function publishRenderJob(payload: unknown) {
  const active = channel ?? await connect();
  active.sendToQueue(QUEUE, Buffer.from(JSON.stringify(payload)), {
    persistent: true,
    contentType: "application/json",
  });
  await active.waitForConfirms();
}

export async function closeQueue() {
  await channel?.close().catch(() => undefined);
  await connection?.close().catch(() => undefined);
}
