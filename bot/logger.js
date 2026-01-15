export function createLogger({ verbose = false } = {}) {
  const info = (...args) => console.log("[opportunity-bot]", ...args);
  const warn = (...args) => console.warn("[opportunity-bot]", ...args);
  const error = (...args) => console.error("[opportunity-bot]", ...args);
  const debug = (...args) => {
    if (verbose) console.log("[opportunity-bot:debug]", ...args);
  };
  return { info, warn, error, debug };
}
