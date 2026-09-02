export function percentile(
  values: readonly number[],
  quantile: number,
): number {
  if (!Number.isFinite(quantile) || quantile < 0 || quantile > 1) {
    throw new RangeError('Quantile must be between 0 and 1.');
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw new RangeError('Percentile samples must be finite numbers.');
  }
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * quantile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const weight = position - lowerIndex;

  return (
    sorted[lowerIndex] + (sorted[upperIndex] - sorted[lowerIndex]) * weight
  );
}

export function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function coefficientOfVariation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean === 0) return 0;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}
