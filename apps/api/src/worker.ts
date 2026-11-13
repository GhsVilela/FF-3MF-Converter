import { parentPort } from 'node:worker_threads';
import type { ConversionOptions, ConversionReport, ConversionStage } from '@ff3mf/shared';
import { asConversionError, convert3mf } from '@ff3mf/core';
import { loadTargetProfile } from '@ff3mf/profiles';

interface WorkerRequest {
  inputPath: string;
  outputPath: string;
  printerId: string;
  nozzle: string;
  processName: string;
  options: ConversionOptions;
}

interface WorkerProgress {
  type: 'progress';
  stage: ConversionStage;
  progress: number;
}

interface WorkerResult {
  type: 'result';
  ok: boolean;
  report?: ConversionReport;
  error?: { code: string; message: string; details?: string[] };
}

parentPort?.on('message', async (message: WorkerRequest) => {
  try {
    const profile = loadTargetProfile(message.printerId, message.nozzle, message.processName);
    const result = await convert3mf(
      message.inputPath,
      message.outputPath,
      profile,
      message.options,
      (progress) => {
        const update: WorkerProgress = { type: 'progress', ...progress };
        parentPort?.postMessage(update);
      },
    );
    const resultMessage: WorkerResult = { type: 'result', ok: true, report: result.report };
    parentPort?.postMessage(resultMessage);
  } catch (error) {
    const conversionError = asConversionError(error);
    const resultMessage: WorkerResult = {
      type: 'result',
      ok: false,
      error: {
        code: conversionError.code,
        message: conversionError.message,
        details: conversionError.details,
      },
    };
    parentPort?.postMessage(resultMessage);
  }
});
