#!/usr/bin/env node
import { readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = process.env.VERSION ?? packageJson.version;
if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version)) {
  throw new Error(`Invalid plugin version: ${version}`);
}

const sourceDir = path.join(root, 'integrations', 'orcaslicer-plugin');
const templatePath = path.join(sourceDir, 'ff3mf_orca.py.in');
const htmlPath = path.join(sourceDir, 'ui', 'panel.html');
const cssPath = path.join(sourceDir, 'ui', 'panel.css');
const jsPath = path.join(sourceDir, 'ui', 'panel.js');
const outputDir = path.join(root, 'build', 'orca-plugin');
// OrcaSlicer imports a .py plugin using the file stem as the module name.
// Dots or other punctuation make Python treat it as a dotted module path and
// the plugin fails to load, so keep the artifact stem import-safe.
const artifactVersion = version.replace(/[^A-Za-z0-9]/g, '_');
const outputName = `ff3mf_orca_${artifactVersion}.py`;
const outputPath = path.join(outputDir, outputName);

const template = readFileSync(templatePath, 'utf8');
const htmlSource = readFileSync(htmlPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');
const js = readFileSync(jsPath, 'utf8');

if (!template.includes('PANEL_HTML = "__FF3MF_PANEL_HTML__"')) {
  throw new Error('Plugin template does not contain the PANEL_HTML placeholder.');
}
if (!template.includes('__FF3MF_VERSION__')) {
  throw new Error('Plugin template does not contain the version placeholder.');
}
if (!htmlSource.includes('/*__FF3MF_CSS__*/') || !htmlSource.includes('/*__FF3MF_JS__*/')) {
  throw new Error('panel.html is missing the CSS or JavaScript placeholder.');
}
if (css.toLowerCase().includes('</style')) {
  throw new Error('panel.css cannot contain a closing style tag.');
}
if (js.toLowerCase().includes('</script')) {
  throw new Error('panel.js cannot contain a closing script tag.');
}

const inlineCss = htmlSource.replace('/*__FF3MF_CSS__*/', () => css);
const inlineHtml = inlineCss.replace('/*__FF3MF_JS__*/', () => js);

if (inlineHtml.includes('"""')) {
  throw new Error(
    'The panel HTML cannot contain a triple double quote inside the embedded plugin.',
  );
}
if (!inlineHtml.toLowerCase().includes('<!doctype html>')) {
  throw new Error('The panel HTML is missing a doctype.');
}
if (inlineHtml.trimEnd().endsWith('\\')) {
  throw new Error('The panel HTML cannot end with a backslash inside the embedded plugin.');
}

const embedded = `PANEL_HTML = r"""${inlineHtml}"""`;
let output = template.replace('PANEL_HTML = "__FF3MF_PANEL_HTML__"', () => embedded);
output = output.replaceAll('__FF3MF_VERSION__', version);

if (output.includes('__FF3MF_PANEL_HTML__') || output.includes('__FF3MF_VERSION__')) {
  throw new Error('The generated plugin still contains an unresolved placeholder.');
}
if (!output.includes('class FlashForgePage(orca.pages.PagesPluginCapabilityBase):')) {
  throw new Error('The generated plugin is missing the Pages capability.');
}
if (!output.includes('@orca.plugin')) {
  throw new Error('The generated plugin is missing the package decorator.');
}

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
writeFileSync(outputPath, output, 'utf8');

console.log(`OrcaSlicer plugin written to ${path.relative(root, outputPath)}`);
console.log(`  version: ${version}`);
console.log(`  size: ${Buffer.byteLength(output, 'utf8')} bytes`);
