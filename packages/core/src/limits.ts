export interface ConversionLimits {
  maxEntries: number;
  maxUncompressedBytes: number;
  maxEntryBytes: number;
  maxCompressionRatio: number;
}

export const DEFAULT_LIMITS: ConversionLimits = {
  maxEntries: 20_000,
  maxUncompressedBytes: 1024 * 1024 * 1024,
  maxEntryBytes: 256 * 1024 * 1024,
  maxCompressionRatio: 300,
};
