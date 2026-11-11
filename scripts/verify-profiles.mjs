import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const profiles = path.join(root, 'profiles');
const errors = [];

function readJson(relative) {
  const file = path.join(profiles, relative);
  if (!existsSync(file)) {
    errors.push(`missing ${relative}`);
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    errors.push(`invalid JSON in ${relative}: ${error.message}`);
    return undefined;
  }
}

const catalog = readJson('catalog.json');
const expected = ['ad5x', 'ad5m', 'ad5m-pro', 'creator-5', 'creator-5-pro'];

if (!catalog) {
  console.error(errors.join('\n'));
  process.exit(1);
}

const ids = catalog.printers.map((printer) => printer.id);
for (const id of expected) {
  if (!ids.includes(id)) errors.push(`catalog is missing printer ${id}`);
}

for (const printer of catalog.printers) {
  const filaments = readJson(`filaments/${printer.id}.json`);
  if (!Array.isArray(filaments) || filaments.length === 0) {
    errors.push(`${printer.id}: no filament presets`);
  }
  const filamentNames = new Set((filaments ?? []).map((preset) => preset.name));
  for (const nozzle of printer.nozzles) {
    const machine = readJson(`machines/${printer.id}/${nozzle.diameter}.json`);
    const processes = readJson(`processes/${printer.id}/${nozzle.diameter}.json`);
    const template = readJson(`templates/${printer.id}.json`);
    if (!machine) errors.push(`${printer.id} ${nozzle.diameter}: missing machine`);
    if (!Array.isArray(processes) || processes.length === 0) {
      errors.push(`${printer.id} ${nozzle.diameter}: no process presets`);
    }
    if (!template?.config || Object.keys(template.config).length < 400) {
      errors.push(`${printer.id}: template is incomplete`);
    }
    if (!template?.application) errors.push(`${printer.id}: template has no application stamp`);
    if (machine && !machine.printer_model)
      errors.push(`${printer.id}: machine has no printer_model`);
    if (!filamentNames.has(nozzle.defaultFilament)) {
      errors.push(`${printer.id} ${nozzle.diameter}: default filament is missing`);
    }
  }
}

if (errors.length > 0) {
  console.error(`Profile verification failed:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}

console.log(
  `Profiles OK: ${catalog.printers.length} printers, ${catalog.printers.reduce(
    (total, printer) => total + printer.nozzles.length,
    0,
  )} nozzle variants.`,
);
