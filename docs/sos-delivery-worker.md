# SOS delivery worker

The SOS delivery worker uses the indexed `deliveryDueAt` field as its work
queue. It does not scan SOS history: a Firestore query returns only records
whose next delivery or refresh deadline is due.

The in-process timer runs every second only to provide a scheduler tick. The
worker performs a Firestore query immediately after startup and on the next
scheduler tick after a delivery is accepted. It continues polling while due
records are being drained. When the query is empty, the next Firestore poll is
delayed for 30 seconds. This keeps idle read usage bounded while preserving
prompt delivery checks.

`SosDeliveryWorker.wake()` is called after an accepted provider response
persists delivery tracking work. Manual status refreshes also wake the worker.
The periodic idle poll remains necessary for recovery after a process restart
or an external writer.

## Domain glossary

- **Delivery work**: provider message/device identifiers plus due time, lease,
  revision, and retry state for one message kind.
- **`deliveryDueAt`**: the minimum due time across active delivery work and a
  pending manual refresh. It is the only field used by the scheduler query.
- **Wake**: an in-process request to run the scheduler on the next scheduler
  tick; it does not replace the indexed Firestore queue or persisted leases.
