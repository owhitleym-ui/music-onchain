// QuickNode Streams filter function. Paste into the Stream's "Filter" step.
// Network: Arc Testnet. Dataset: Logs. Destination: webhook -> https://<domain>/api/streams/webhook
//
// Keeps only logs emitted by our Competition contract and drops empty batches, so the webhook
// only fires when something happened in a competition. Replace the address after every redeploy.
// The webhook decodes events with the ABI, so new event types need no change here.

const COMPETITION = "0xREPLACE_WITH_NEXT_PUBLIC_COMPETITION_ADDRESS".toLowerCase();

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- called by QuickNode
function main(stream) {
  const batches = Array.isArray(stream.data) ? stream.data : [stream.data];
  const logs = [];
  for (const batch of batches) {
    const items = Array.isArray(batch) ? batch : [batch];
    for (const log of items) {
      if (log && typeof log.address === "string" && log.address.toLowerCase() === COMPETITION) {
        logs.push(log);
      }
    }
  }
  if (logs.length === 0) return null; // nothing to deliver for this block range
  return { logs };
}
