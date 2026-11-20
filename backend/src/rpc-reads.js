const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function transient(error) {
  const seen = new Set();
  for (let item = error; item && !seen.has(item); item = item.cause) {
    seen.add(item);
    // Public Arc gateways throttle bursts and can temporarily disagree on the head.
    if ([-32005, -32014, 429, 503].includes(item.code) || [429, 503].includes(item.status)) return true;
  }
  return false;
}

export function createRpcReadGuard({ pause = sleep, clock = Date.now, logIntervalMs = 1100 } = {}) {
  let nextLogAt = 0;
  let logQueue = Promise.resolve();
  async function read(operation) {
    for (let attempt = 0; ; attempt++) {
      try { return await operation(); } catch (error) {
        if (attempt >= 3 || !transient(error)) throw error;
        await pause(700 * 2 ** attempt);
      }
    }
  }
  return {
    read,
    logs(operation) {
      const result = logQueue.then(() => read(async () => {
        const delay = nextLogAt - clock();
        if (delay > 0) await pause(delay);
        nextLogAt = clock() + logIntervalMs;
        return operation();
      }));
      logQueue = result.catch(() => {});
      return result;
    },
  };
}
