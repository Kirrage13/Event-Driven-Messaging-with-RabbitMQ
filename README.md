### README requirements (2 points)

Your README must contain the following two sections. You may extend or replace this README, but these must be present:

1. **Message flow explanation** — When POST /orders is called, the Order Service creates a unique correlationId using UUID. It also adds an orderId and a timestamp to the order. The order is saved in memory and then sent to RabbitMQ through the orders.exchange fanout exchange. The correlationId is included in the message body and in the message headers so the order can be tracked across services

RabbitMQ sends the same message to three queues: payments.queue, inventory.queue, and notifications.queue. Each service processes the order independently. Consumers use manual acknowledgements (ack and nack) to make sure messages are not lost. If processing fails, the message is retried after a short delay. After several failed attempts (MAX_RETRIES), the message is sent to the dead letter queue (orders.dlq). The Notification Service also checks if the order was already processed and skips duplicates to avoid writing the same log entry twice

2. **EAI Pattern mapping table** — 

    | Pattern | Where Applied | Your Explanation |
    |---|---|---|
    | Publish-Subscribe Channel |orders.exchange fanout exchange |One order event is sent to multiple services at the same time |
    | Dead Letter Channel |orders.dlq.exchange -> orders.dlq |Messages that fail too many times are sent to a special queue for inspection |
    | Correlation Identifier |correlationId in headers and message body |This ID helps track the same order across all services |
    | Guaranteed Delivery |manual ack / nack and retry queues |Messages are retried if processing fails and are only removed after success |
    | Idempotent Receiver |Notification Service with processed-ids.json |The service remembers processed orders and ignores duplicates |
---