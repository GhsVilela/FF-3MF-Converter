import { mkdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type {
  ConversionOptions,
  ConversionReport,
  ConversionResult,
  SourceAnalysis,
} from '@open3mf/shared';
import { buildTargetConfig, summarizeSettings, type TargetProfileInput } from './config.js';
import { ConversionError } from './errors.js';
import { patchModelSettingsXml } from './model-settings.js';
import { loadSourceAsync } from './source.js';
import { scanModelXml, rewriteModelXml } from './xml.js';
import { readZip, writeZip, type ZipOutputEntry } from './zip.js';

export async function analyze3mf(filePath: string): Promise<SourceAnalysis> {
  const source = await loadSourceAsync(filePath);
  return source.analysis;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function contentTypesXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>',
    ' <Default Extension="png" ContentType="image/png"/>',
    ' <Default Extension="jpg" ContentType="image/jpeg"/>',
    ' <Default Extension="jpeg" ContentType="image/jpeg"/>',
    ' <Default Extension="exr" ContentType="image/x-exr"/>',
    ' <Default Extension="gcode" ContentType="text/x.gcode"/>',
    ' <Default Extension="json" ContentType="application/json"/>',
    ' <Default Extension="config" ContentType="text/plain"/>',
    '</Types>',
  ].join('\n');
}

function rootRelationshipsXml(hasThumbnail: boolean): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ' <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>',
    ...(hasThumbnail
      ? [
          ' <Relationship Target="/Metadata/thumbnail.png" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>',
        ]
      : []),
    '</Relationships>',
  ].join('\n');
}

function modelRelationshipsXml(modelFileNames: string[]): string {
  const relationships = modelFileNames.map(
    (name, index) =>
      ` <Relationship Target="/${xmlEscape(name)}" Id="rel-${index + 1}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ...relationships,
    '</Relationships>',
  ].join('\n');
}

function validateOutput(
  outputPath: string,
  profile: TargetProfileInput,
  targetSlotCount: number,
  application: string,
): Promise<void> {
  return readZip(outputPath).then((contents) => {
    const configBuffer = contents.files.get('Metadata/project_settings.config');
    if (!configBuffer) {
      throw new ConversionError('OUTPUT_VALIDATION_FAILED', 'Output is missing project settings');
    }
    const config = JSON.parse(configBuffer.toString('utf8')) as Record<string, unknown>;
    const details: string[] = [];

    const machineModel = (profile.machine.printer_model as string | undefined) ?? '';
    if (config.printer_model !== machineModel) {
      details.push(`printer_model is ${String(config.printer_model)} instead of ${machineModel}`);
    }
    const colors = Array.isArray(config.filament_colour) ? config.filament_colour : [];
    if (colors.length !== targetSlotCount) {
      details.push(`filament_colour has ${colors.length} entries, expected ${targetSlotCount}`);
    }
    const filamentIds = Array.isArray(config.filament_settings_id)
      ? config.filament_settings_id
      : [];
    if (filamentIds.length !== targetSlotCount) {
      details.push(
        `filament_settings_id has ${filamentIds.length} entries, expected ${targetSlotCount}`,
      );
    }
    const diff = Array.isArray(config.different_settings_to_system)
      ? config.different_settings_to_system
      : [];
    if (diff.length !== targetSlotCount + 2) {
      details.push(
        `different_settings_to_system has ${diff.length} entries, expected ${targetSlotCount + 2}`,
      );
    }
    const nozzle = Array.isArray(config.nozzle_diameter) ? config.nozzle_diameter : [];
    if (nozzle.length !== profile.nozzle.build.extruders) {
      details.push(
        `nozzle_diameter has ${nozzle.length} entries, expected ${profile.nozzle.build.extruders}`,
      );
    }

    const rootBuffer = contents.files.get('3D/3dmodel.model');
    if (!rootBuffer) {
      details.push('missing 3D/3dmodel.model');
    } else {
      const rootScan = scanModelXml(rootBuffer.toString('utf8'));
      if (rootScan.metadata.Application !== application) {
        details.push(
          `Application stamp is ${String(rootScan.metadata.Application)} instead of ${application}`,
        );
      }
      for (const [name, buffer] of contents.files) {
        if (!/^3D\/.*\.model$/i.test(name)) continue;
        const scan = scanModelXml(buffer.toString('utf8'));
        for (const state of scan.paintStates) {
          if (state > targetSlotCount) {
            details.push(`${name} references filament slot ${state} after remapping`);
          }
        }
      }
    }

    if (details.length > 0) {
      throw new ConversionError(
        'OUTPUT_VALIDATION_FAILED',
        'The converted file failed validation and was not returned.',
        details.slice(0, 12),
      );
    }
  });
}

export async function convert3mf(
  inputPath: string,
  outputPath: string,
  profile: TargetProfileInput,
  options: ConversionOptions,
): Promise<ConversionResult> {
  const startedAt = Date.now();
  const source = await loadSourceAsync(inputPath);
  const built = buildTargetConfig(source, profile, options);

  const rootXml = rewriteModelXml(source.rootXml, {
    paintMap: built.paintMap,
    translate: built.translate,
    scale: built.scale,
    unitScale: built.unitScale,
    setMetadata: built.metadata.set,
    stripMetadata: built.metadata.strip,
    isRootModel: true,
    setUnit: 'millimeter',
  });

  const modelSettingsXml = patchModelSettingsXml(
    source.modelSettingsXml,
    built.paintMap,
    source.plateCount,
  );

  const entries: ZipOutputEntry[] = [
    { name: '[Content_Types].xml', data: contentTypesXml() },
    {
      name: '_rels/.rels',
      data: rootRelationshipsXml(source.contents.files.has('Metadata/thumbnail.png')),
    },
    { name: '3D/3dmodel.model', data: rootXml },
  ];

  const modelFileNames = [...source.modelFiles.keys()].sort();
  if (modelFileNames.length > 0) {
    entries.push({
      name: '3D/_rels/3dmodel.model.rels',
      data: modelRelationshipsXml(modelFileNames),
    });
  }

  for (const name of modelFileNames) {
    const model = source.modelFiles.get(name);
    if (!model) continue;
    entries.push({
      name,
      data: rewriteModelXml(model.xml, {
        paintMap: built.paintMap,
        scale: built.scale,
        unitScale: built.unitScale,
        isRootModel: false,
      }),
      compress: true,
    });
  }

  for (const name of source.contents.names) {
    if (name.startsWith('3D/Textures/')) {
      const buffer = source.contents.files.get(name);
      if (buffer) entries.push({ name, data: buffer, compress: true });
    }
  }

  entries.push(
    {
      name: 'Metadata/project_settings.config',
      data: `${JSON.stringify(built.projectConfig, null, 2)}\n`,
    },
    { name: 'Metadata/model_settings.config', data: modelSettingsXml },
  );

  for (const optional of [
    'Metadata/custom_gcode_per_layer.xml',
    'Metadata/layer_config_ranges.xml',
    'Metadata/thumbnail.png',
  ]) {
    const buffer = source.contents.files.get(optional);
    if (buffer)
      entries.push({
        name: optional,
        data: buffer,
        compress: optional.endsWith('.png') ? false : true,
      });
  }

  mkdirSync(path.dirname(outputPath), { recursive: true });
  try {
    await writeZip(outputPath, entries);
    await validateOutput(outputPath, profile, built.targetSlotCount, profile.template.application);
  } catch (error) {
    try {
      unlinkSync(outputPath);
    } catch {
      // The output may not exist yet.
    }
    throw error;
  }

  const counts = summarizeSettings(built.settings);
  const report: ConversionReport = {
    source: source.analysis,
    target: {
      printerId: profile.printer.id,
      printerName: profile.printer.name,
      nozzle: profile.nozzle.diameter,
      processName: profile.process.name,
      maxColors: profile.printer.maxColors,
      filamentPresets: built.filamentMapping.map((entry) => entry.targetPreset),
      templateSource: profile.template.source,
    },
    settings: built.settings,
    filaments: built.filamentMapping,
    plates: built.plates,
    warnings: [...source.analysis.warnings, ...built.warnings],
    stats: {
      ...counts,
      durationMs: Date.now() - startedAt,
      outputBytes: statSync(outputPath).size,
    },
  };

  return { report, outputPath };
}
