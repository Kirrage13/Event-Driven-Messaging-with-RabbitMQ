const fs = require('fs');
const path = require('path');
const { connectWithRetry, getRetryCount } = require('/app/shared/rabbit');

const QUEUE = 'notifications.queue';
const RESULTS_EXCHANGE = 'results.notification';
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES) || 3;

const DATA_DIR = '/data';
const PROCESSED_IDS_FILE = path.join(DATA_DIR, 'processed-ids.json');
const NOTIFICATION_LOG_FILE = path.join(DATA_DIR, 'notification.log');

function loadProcessedIds() {
  try {
    const raw = fs.readFileSync(PROCESSED_IDS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let processedIds = loadProcessedIds();

  const { connection, channel } = await connectWithRetry(process.env.RABBITMQ_URL);
  await channel.prefetch(1);

  console.log(`[Notification] Consuming from ${QUEUE}`);

  channel.consume(QUEUE, async (msg) => {
    if (!msg) return;

    const correlationId = msg.properties.headers?.correlationId;
    const retryCount = getRetryCount(msg);

    if (processedIds.includes(correlationId)) {
      channel.ack(msg);
      console.log(`[Notification] Duplicate skipped: ${correlationId}`);
      return;
    }

    console.log(`[Notification] Processing ${correlationId} (attempt ${retryCount + 1})`);

    try {
      const order = JSON.parse(msg.content.toString());

      const logEntry = {
        correlationId,
        orderId: order.orderId,
        customerId: order.customerId,
        timestamp: new Date().toISOString(),
        message: 'Order received',
      };

      fs.appendFileSync(NOTIFICATION_LOG_FILE, JSON.stringify(logEntry) + '\n');

      processedIds.push(correlationId);
      fs.writeFileSync(PROCESSED_IDS_FILE, JSON.stringify(processedIds));

      channel.ack(msg);

      const resultEvent = {
        correlationId,
        source: 'notification',
        status: 'success',
        timestamp: new Date().toISOString(),
        details: { message: 'Notification logged successfully' },
      };

      channel.publish(
        RESULTS_EXCHANGE,
        '',
        Buffer.from(JSON.stringify(resultEvent)),
        { headers: { correlationId }, contentType: 'application/json' }
      );

      return;
    } catch (err) {
      if (retryCount >= MAX_RETRIES - 1) {
        channel.publish(process.env.DLQ_EXCHANGE, '', msg.content, {
          headers: msg.properties.headers,
        });
        channel.ack(msg);
        console.log(`[Notification] → DLQ after ${retryCount + 1} attempts: ${err.message}`);
      } else {
        channel.nack(msg, false, false);
        console.log(`[Notification] → Retry (attempt ${retryCount + 1}): ${err.message}`);
      }
    }
  });
}

main().catch(console.error);
