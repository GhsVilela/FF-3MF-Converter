#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { analyze3mf, convert3mf, ConversionError } from '@ff3mf/core';
import { getCatalog, loadTargetProfile } from '@ff3mf/profiles';
import type { ConversionOptions } from '@ff3mf/shared';

const program = new Command();

program
  .name('ff3mf')
  .description('Convert 3MF projects into FlashForge Flash Studio projects')
  .version('0.1.0');

program
  .command('printers')
  .description('List supported printers and nozzles')
  .action(() => {
    const catalog = getCatalog();
    for (const printer of catalog.printers) {
      console.log(
        `${printer.id.padEnd(14)} ${printer.name}  (${printer.maxColors} colour${
          printer.maxColors === 1 ? '' : 's'
        })`,
      );
      for (const nozzle of printer.nozzles) {
        console.log(`  ${nozzle.diameter} mm  ${nozzle.processes.length} process presets`);
      }
    }
  });

program
  .command('analyze')
  .argument('<input>', 'input .3mf file')
  .description('Inspect a 3MF project without converting it')
  .action(async (input: string) => {
    const analysis = await analyze3mf(input);
    console.log(JSON.stringify(analysis, null, 2));
  });

program
  .command('convert')
  .argument('<input>', 'input .3mf file')
  .requiredOption('-p, --printer <id>', 'target printer id (see "ff3mf printers")')
  .option('-n, --nozzle <mm>', 'target nozzle diameter', '0.4')
  .option('--process <name>', 'target process preset name')
  .option('-o, --out <file>', 'output .3mf path')
  .option('--layout <mode>', 'center, keep or scale', 'center')
  .option('--no-preserve-temps', 'use target filament temperatures instead of the author values')
  .option('--mapping <pairs>', 'source:target slot mapping, e.g. 1:2,2:1')
  .option('--report <file>', 'write the JSON conversion report')
  .option('--json', 'print the full JSON report')
  .action(async (input: string, options: Record<string, unknown>) => {
    try {
      const analysis = await analyze3mf(input);
      let profile = loadTargetProfile(
        String(options.printer),
        String(options.nozzle),
        options.process ? String(options.process) : undefined,
      );
      if (!options.process && analysis.layerHeight) {
        const closest = [...profile.processes].sort(
          (left, right) =>
            Math.abs(Number.parseFloat(left.layerHeight) - analysis.layerHeight!) -
            Math.abs(Number.parseFloat(right.layerHeight) - analysis.layerHeight!),
        )[0];
        if (closest && closest.name !== profile.process.name) {
          profile = loadTargetProfile(
            String(options.printer),
            String(options.nozzle),
            closest.name,
          );
        }
      }

      const mapping: Record<string, number> = {};
      if (typeof options.mapping === 'string') {
        for (const pair of options.mapping.split(',')) {
          const [sourceRaw, targetRaw] = pair.split(':');
          const source = Number(sourceRaw);
          const target = Number(targetRaw);
          if (!Number.isFinite(source) || !Number.isFinite(target)) {
            throw new Error(`Invalid mapping pair: ${pair}`);
          }
          mapping[String(source)] = target;
        }
      }

      const layout = String(options.layout);
      if (!['center', 'keep', 'scale'].includes(layout)) {
        throw new Error('--layout must be center, keep or scale');
      }

      const outputPath =
        typeof options.out === 'string'
          ? options.out
          : path.join(
              path.dirname(input),
              `${path.basename(input, path.extname(input))}_${options.printer}.3mf`,
            );

      const conversion: ConversionOptions = {
        printerId: String(options.printer),
        nozzle: String(options.nozzle),
        processName: profile.process.name,
        colorMapping: mapping,
        preserveTemperatures: options.preserveTemps !== false,
        layout: layout as ConversionOptions['layout'],
      };

      const result = await convert3mf(input, outputPath, profile, conversion);
      console.log(`Converted: ${outputPath}`);
      console.log(`Printer:   ${result.report.target.printerName}`);
      console.log(`Process:   ${result.report.target.processName}`);
      console.log(
        `Settings:  ${result.report.stats.settingsKept} kept, ${result.report.stats.settingsChanged} adjusted, ${result.report.stats.settingsDropped} dropped`,
      );
      for (const warning of result.report.warnings) console.warn(`Warning: ${warning}`);
      if (typeof options.report === 'string') {
        writeFileSync(options.report, `${JSON.stringify(result.report, null, 2)}\n`);
        console.log(`Report:    ${options.report}`);
      }
      if (options.json) console.log(JSON.stringify(result.report, null, 2));
    } catch (error) {
      if (error instanceof ConversionError) {
        console.error(`Error [${error.code}]: ${error.message}`);
        for (const detail of error.details ?? []) console.error(`  - ${detail}`);
      } else {
        console.error(error instanceof Error ? error.message : String(error));
      }
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
