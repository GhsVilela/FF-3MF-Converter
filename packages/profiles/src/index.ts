import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  NozzleSummary,
  PrinterSummary,
  ProcessSummary,
  ProfileCatalog,
} from '@ff3mf/shared';

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
const profileCandidates = [
  path.resolve(here, '../../../profiles'), // workspace: packages/profiles/dist
  path.resolve(here, '../../../../profiles'), // node_modules/@ff3mf/profiles/dist (portable)
  path.resolve(process.cwd(), 'profiles'), // Docker, portable launcher, repo root
];

const defaultProfilesDir =
  profileCandidates.find((candidate) => existsSync(path.join(candidate, 'catalog.json'))) ??
  profileCandidates[0]!;

export function profilesDir(): string {
  return process.env.PROFILES_DIR
    ? path.resolve(process.env.PROFILES_DIR)
    : defaultProfilesDir;
}

function readJson<T>(relativePath: string): T {
  // Confine every profile lookup to the profile directory. This keeps caller
  // supplied ids and catalog paths from escaping the bundled data.
  const root = profilesDir();
  const full = path.resolve(root, relativePath);
  const relative = path.relative(root, full);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Invalid profile path "${relativePath}"`);
  }
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
  // Use the catalog values, not the caller values, so an unknown or
  // traversal-shaped id can never reach the profile file path.
  const machine = readJson<Record<string, unknown>>(
    `machines/${printer.id}/${nozzle.diameter}.json`,
  );
  const processes = readJson<ProcessPreset[]>(
    `processes/${printer.id}/${nozzle.diameter}.json`,
  ).filter((preset) => !preset.name.startsWith('fdm_'));
  const filaments = readJson<FilamentPreset[]>(`filaments/${printer.id}.json`);
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
  const printer = findPrinter(printerId);
  const filaments = readJson<FilamentPreset[]>(`filaments/${printer.id}.json`);
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
