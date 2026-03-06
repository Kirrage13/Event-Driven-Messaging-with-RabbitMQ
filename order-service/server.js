const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { connectWithRetry } = require('/app/shared/rabbit');

const PORT = parseInt(process.env.PORT || '3000', 10);
const RABBITMQ_URL = process.env.RABBITMQ_URL;
const ORDERS_EXCHANGE = 'orders.exchange';

async function main() {
  const app = express();
  app.use(express.json());

  const orders = [];

  const { connection, channel } = await connectWithRetry(RABBITMQ_URL);

  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.post('/orders', (req, res) => {
    try {
      const correlationId = uuidv4();
      const orderId = `ord-${correlationId.slice(0, 8)}`;
      const timestamp = new Date().toISOString();

      const enrichedOrder = {
        ...req.body,
        orderId,
        correlationId,
        timestamp,
      };

      const content = Buffer.from(JSON.stringify(enrichedOrder));

      channel.publish(ORDERS_EXCHANGE, '', content, {
        headers: { correlationId },
        contentType: 'application/json',
      });

      orders.push(enrichedOrder);

      res.status(201).json({ correlationId, status: 'accepted' });
    } catch (err) {
      console.error('POST /orders failed:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.get('/orders/:correlationId', (req, res) => {
    const found = orders.find((o) => o.correlationId === req.params.correlationId);
    if (!found) return res.status(404).json({ error: 'Not Found' });
    return res.status(200).json(found);
  });

  const server = app.listen(PORT, () => {
    console.log(`order-service listening on port ${PORT}`);
  });

  const shutdown = async () => {
    console.log('Shutting down order-service...');
    server.close(() => console.log('HTTP server closed'));
    try {
      await channel.close();
      await connection.close();
    } catch (_) {}
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('order-service failed to start:', err);
  process.exit(1);
});