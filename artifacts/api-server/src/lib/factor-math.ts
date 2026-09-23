export function rollingZScore(
  values: (number | null)[],
  windowSize: number,
): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  let sumSq = 0;
  const buffer: number[] = [];

  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value === null || !Number.isFinite(value)) {
      sum = 0;
      sumSq = 0;
      buffer.length = 0;
      continue;
    }

    buffer.push(value);
    sum += value;
    sumSq += value * value;

    if (buffer.length > windowSize) {
      const removed = buffer.shift()!;
      sum -= removed;
      sumSq -= removed * removed;
    }

    if (buffer.length === windowSize) {
      const mean = sum / windowSize;
      // pandas rolling.std() defaults to sample standard deviation (ddof=1).
      const variance = Math.max(
        0,
        (sumSq - (sum * sum) / windowSize) / (windowSize - 1),
      );
      const standardDeviation = Math.sqrt(variance);
      result[index] = standardDeviation > 0
        ? (value - mean) / standardDeviation
        : 0;
    }
  }

  return result;
}