export type ErrorCode =
  | 'INVALID_FILE'
  | 'INVALID_ZIP'
  | 'ZIP_LIMIT'
  | 'UNSAFE_PATH'
  | 'NO_MODEL'
  | 'SLICED_FILE'
  | 'UNSUPPORTED_FILE'
  | 'PROFILE_ERROR'
  | 'CONVERSION_FAILED'
  | 'OUTPUT_VALIDATION_FAILED';

export class ConversionError extends Error {
  readonly code: ErrorCode;
  readonly details?: string[];

  constructor(code: ErrorCode, message: string, details?: string[]) {
    super(message);
    this.name = 'ConversionError';
    this.code = code;
    this.details = details;
  }
}

export function asConversionError(error: unknown): ConversionError {
  if (error instanceof ConversionError) return error;
  if (error instanceof Error) {
    return new ConversionError('CONVERSION_FAILED', error.message);
  }
  return new ConversionError('CONVERSION_FAILED', 'Unknown conversion error');
}
