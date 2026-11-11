import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  NozzleSummary,
  PrinterSummary,
  ProcessSummary,
  ProfileCatalog,
} from '@open3mf/shared';

export interface ProcessPreset extends ProcessSummary {
  config: Record<string, unknown>;
}

export interface FilamentPreset {
  name: string;
  type: string;
  config: Record<string, unknown>;
}

export interface TemplateData {
  printer: string;
  nozzle: string;
  machineProfile: string;
  processProfile: string;
  filamentProfile: string;
  application: string;
  threeMfVersion: string;
  source: string;
  config: Record<string, unknown>;
}

export interface TargetProfile {
  printer: PrinterSummary;
  nozzle: NozzleSummary;
  machine: Record<string, unknown>;
  processes: ProcessPreset[];
  filaments: FilamentPreset[];
  template: TemplateData;
  process: ProcessPreset;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultProfilesDir = path.resolve(here, '../../../profiles');

export function profilesDir(): string {
  return process.env.PROFILES_DIR
    ? path.resolve(process.env.PROFILES_DIR)
    : defaultProfilesDir;
}

function readJson<T>(relativePath: string): T {
  const full = path.join(profilesDir(), relativePath);
  return JSON.parse(readFileSync(full, 'utf8')) as T;
}

let catalogCache: ProfileCatalog | undefined;

export function getCatalog(): ProfileCatalog {
  catalogCache ??= readJson<ProfileCatalog>('catalog.json');
  return catalogCache;
}

export function getPrinters(): PrinterSummary[] {
  return getCatalog().printers;
}

export function findPrinter(printerId: string): PrinterSummary {
  const printer = getPrinters().find((candidate) => candidate.id === printerId);
  if (!printer) {
    throw new Error(`Unknown printer "${printerId}"`);
  }
  return printer;
}

export function findNozzle(printer: PrinterSummary, nozzle: string): NozzleSummary {
  const entry = printer.nozzles.find((candidate) => candidate.diameter === nozzle);
  if (!entry) {
    throw new Error(`Printer "${printer.name}" does not support a ${nozzle} mm nozzle`);
  }
  return entry;
}

export function loadTargetProfile(
  printerId: string,
  nozzleDiameter: string,
  processName?: string,
): TargetProfile {
  const printer = findPrinter(printerId);
  const nozzle = findNozzle(printer, nozzleDiameter);
  const machine = readJson<Record<string, unknown>>(
    `machines/${printerId}/${nozzleDiameter}.json`,
  );
  const processes = readJson<ProcessPreset[]>(`processes/${printerId}/${nozzleDiameter}.json`);
  const filaments = readJson<FilamentPreset[]>(`filaments/${printerId}.json`);
  const template = readJson<TemplateData>(nozzle.template);

  const process = processName
    ? processes.find((candidate) => candidate.name === processName)
    : processes.find((candidate) => candidate.name === nozzle.defaultProcess) ??
      processes.find((candidate) => candidate.name.includes('0.20mm Standard')) ??
      processes[0];

  if (!process) {
    throw new Error(`No process presets found for ${printer.name} ${nozzleDiameter} mm`);
  }

  return { printer, nozzle, machine, processes, filaments, template, process };
}

export function findFilamentPreset(
  profile: TargetProfile,
  material: string,
): FilamentPreset | undefined {
  const normalized = material.trim().toUpperCase();
  return (
    profile.filaments.find((preset) => preset.type?.toUpperCase() === normalized) ??
    profile.filaments.find((preset) => preset.name.toUpperCase().includes(normalized)) ??
    profile.filaments.find((preset) => preset.name === profile.nozzle.defaultFilament) ??
    profile.filaments[0]
  );
}

export function availableMaterials(printerId: string): string[] {
  const filaments = readJson<FilamentPreset[]>(`filaments/${printerId}.json`);
  return [...new Set(filaments.map((preset) => preset.type).filter(Boolean))].sort();
}

export function profileManifest() {
  const catalog = getCatalog();
  return {
    generatedAt: catalog.generatedAt,
    sources: catalog.sources,
    printerCount: catalog.printers.length,
  };
}
