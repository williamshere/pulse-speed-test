function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function pingStatistics(samples) {
  if (samples.length === 0) {
    throw new Error("Ping measurement failed: no requests succeeded.");
  }
  const jitter = samples.slice(1).map((value, index) => Math.abs(value - samples[index]));
  return {
    ping: median(samples),
    jitter: jitter.length > 0 ? median(jitter) : 0,
  };
}
