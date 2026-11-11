import { parentPort } from 'node:worker_threads';
import type { ConversionOptions } from '@open3mf/shared';
import { asConversionError, convert3mf } from '@open3mf/core';
import { loadTargetProfile } from '@open3mf/profiles';

interface WorkerRequest {
  inputPath: string;
  outputPath: string;
  printerId: string;
  nozzle: string;
  processName: string;
  options: ConversionOptions;
}

parentPort?.on('message', async (message: WorkerRequest) => {
  try {
    const profile = loadTargetProfile(message.printerId, message.nozzle, message.processName);
    const result = await convert3mf(
      message.inputPath,
      message.outputPath,
      profile,
      message.options,
    );
    parentPort?.postMessage({ ok: true, report: result.report });
  } catch (error) {
    const conversionError = asConversionError(error);
    parentPort?.postMessage({
      ok: false,
      error: {
        code: conversionError.code,
        message: conversionError.message,
        details: conversionError.details,
      },
    });
  }
});
