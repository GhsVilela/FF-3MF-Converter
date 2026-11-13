import { z } from 'zod';

export const PROFILE_SOURCE_KEYS = ['230', '250'] as const;

export interface ProfileSource {
  name: string;
  version: string;
  license: string;
  url: string;
}

export interface BuildVolume {
  area: string[];
  height: number;
  extruders: number;
}

export interface ProcessSummary {
  name: string;
  layerHeight: string;
}

export interface NozzleSummary {
  diameter: string;
  machineProfile: string;
  template: string;
  defaultProcess: string;
  defaultFilament: string;
  build: BuildVolume;
  processes: ProcessSummary[];
}

export interface PrinterSummary {
  id: string;
  name: string;
  series: string;
  maxColors: number;
  compatibility: {
    templateSource: string;
    flashStudio: string;
  };
  nozzles: NozzleSummary[];
}

export interface ProfileCatalog {
  generatedAt: string;
  sources: Record<string, ProfileSource>;
  printers: PrinterSummary[];
}

export interface SourceFilament {
  slot: number;
  color: string;
  type: string;
  name: string;
  used: boolean;
}

export interface SourceAnalysis {
  fileName: string;
  fileSize: number;
  sourceApp: string;
  sourcePrinter?: string;
  sourceProcess?: string;
  layerHeight?: number;
  nozzle?: string;
  plates: number;
  objects: number;
  triangles: number;
  colors: SourceFilament[];
  usedColorCount: number;
  hasPaint: boolean;
  hasCustomSupports: boolean;
  hasCustomSeams: boolean;
  hasProjectSettings: boolean;
  isSliced: boolean;
  warnings: string[];
}

export type ConversionStage = 'analysing' | 'profiling' | 'rewriting' | 'packaging' | 'validating';

export type JobStage = 'queued' | ConversionStage | 'completed' | 'failed';

export interface ConversionProgress {
  stage: ConversionStage;
  progress: number;
}

export type ConversionProgressHandler = (update: ConversionProgress) => void;

export type LayoutMode = 'center' | 'keep' | 'scale';

export interface ConversionOptions {
  printerId: string;
  nozzle: string;
  processName?: string;
  colorMapping?: Record<string, number>;
  preserveTemperatures?: boolean;
  keepAllColors?: boolean;
  layout?: LayoutMode;
}

export interface FilamentMapping {
  sourceSlot: number;
  sourceColor: string;
  sourceType: string;
  targetSlot: number;
  targetPreset: string;
  targetColor: string;
  targetType: string;
  merged: boolean;
}

export type Decision = 'kept' | 'translated' | 'clamped' | 'replaced' | 'dropped';

export interface ChangeEntry {
  key: string;
  category:
    | 'quality'
    | 'supports'
    | 'adhesion'
    | 'temperature'
    | 'filament'
    | 'machine'
    | 'metadata'
    | 'other';
  decision: Decision;
  sourceValue?: unknown;
  targetValue?: unknown;
  reason: string;
}

export interface PlateInfo {
  plate: number;
  objects: number;
  fits: boolean;
  moved: boolean;
  note?: string;
}

export interface ConversionReport {
  source: SourceAnalysis;
  target: {
    printerId: string;
    printerName: string;
    nozzle: string;
    processName: string;
    maxColors: number;
    filamentPresets: string[];
    templateSource: string;
  };
  settings: ChangeEntry[];
  filaments: FilamentMapping[];
  plates: PlateInfo[];
  warnings: string[];
  stats: {
    settingsKept: number;
    settingsChanged: number;
    settingsDropped: number;
    durationMs: number;
    outputBytes: number;
  };
}

export interface ConversionResult {
  report: ConversionReport;
  outputPath: string;
}

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    details?: string[];
  };
}

export const conversionOptionsSchema = z.object({
  printerId: z.string().min(1),
  nozzle: z.string().regex(/^\d+(\.\d+)?$/, 'Nozzle must be a decimal diameter such as 0.4'),
  processName: z.string().min(1).optional(),
  colorMapping: z.record(z.string(), z.number().int().min(1)).optional(),
  preserveTemperatures: z.boolean().optional(),
  keepAllColors: z.boolean().optional(),
  layout: z.enum(['center', 'keep', 'scale']).optional(),
});

export const createConversionSchema = conversionOptionsSchema.extend({
  uploadId: z.string().uuid(),
});

export type CreateConversionRequest = z.infer<typeof createConversionSchema>;
