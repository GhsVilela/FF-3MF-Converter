#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = process.env.VERSION ?? packageJson.version;
const nodeVersion = process.env.NODE_RUNTIME_VERSION ?? '22.20.0';
const buildDir = path.join(root, 'build', 'portable');
const cacheDir = path.join(root, 'build', 'cache');
const artifactDir = path.join(root, 'build', 'artifacts');
const stageRoot = path.join(buildDir, 'stage');
const appDir = path.join(buildDir, 'app');

const nodeDownloads = {
  'linux-x64': {
    archive: `node-v${nodeVersion}-linux-x64.tar.xz`,
    url: `https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-linux-x64.tar.xz`,
    sha256: '00bbd05e306ea68b6e13e17360d0e2f680b493ef95f2fea1c4296ff7437530bc',
  },
  'win-x64': {
    archive: `node-v${nodeVersion}-win-x64.zip`,
    url: `https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-win-x64.zip`,
    sha256: 'bb819d6eb8f5bfda294bbc83a7e4ec6539da67c4233d54b0d655b9248b15e29d',
  },
};

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  execFileSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: options.stdio ?? 'inherit',
    env: { ...process.env, ...(options.env ?? {}) },
  });
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

async function download(url, destination) {
  if (existsSync(destination)) return;
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  const arrayBuffer = await response.arrayBuffer();
  writeFileSync(destination, Buffer.from(arrayBuffer));
}

async function ensureNodeRuntime(platform) {
  const entry = nodeDownloads[platform];
  mkdirSync(cacheDir, { recursive: true });
  const archivePath = path.join(cacheDir, entry.archive);
  await download(entry.url, archivePath);
  const actual = sha256(archivePath);
  if (actual !== entry.sha256) {
    throw new Error(`Checksum mismatch for ${entry.archive}: ${actual}`);
  }

  const extractDir = path.join(cacheDir, `node-${platform}`);
  if (!existsSync(extractDir)) {
    mkdirSync(extractDir, { recursive: true });
    if (platform === 'linux-x64') {
      run('tar', ['-xJf', archivePath, '-C', extractDir]);
    } else {
      run('python3', ['-m', 'zipfile', '-e', archivePath, extractDir]);
    }
  }

  const base = path.join(
    extractDir,
    platform === 'linux-x64' ? `node-v${nodeVersion}-linux-x64` : `node-v${nodeVersion}-win-x64`,
  );
  const nodeBinary = path.join(base, platform === 'linux-x64' ? 'bin/node' : 'node.exe');
  if (!existsSync(nodeBinary)) throw new Error(`Node runtime not found: ${nodeBinary}`);
  return { nodeBinary, base };
}

function buildProductionApp() {
  console.log('\nBuilding the application...');
  run('npm', ['run', 'build']);

  rmSync(appDir, { recursive: true, force: true });
  mkdirSync(appDir, { recursive: true });

  for (const file of ['package.json', 'package-lock.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    copyFileSync(path.join(root, file), path.join(appDir, file));
  }

  for (const packageName of ['shared', 'profiles', 'core']) {
    const packageRoot = path.join(root, 'packages', packageName);
    cpSync(path.join(packageRoot, 'dist'), path.join(appDir, 'packages', packageName, 'dist'), {
      recursive: true,
    });
    copyFileSync(
      path.join(packageRoot, 'package.json'),
      path.join(appDir, 'packages', packageName, 'package.json'),
    );
  }

  for (const appName of ['api', 'cli']) {
    const appRoot = path.join(root, 'apps', appName);
    cpSync(path.join(appRoot, 'dist'), path.join(appDir, 'apps', appName, 'dist'), {
      recursive: true,
    });
    copyFileSync(
      path.join(appRoot, 'package.json'),
      path.join(appDir, 'apps', appName, 'package.json'),
    );
  }

  cpSync(path.join(root, 'apps', 'web', 'dist'), path.join(appDir, 'apps', 'web', 'dist'), {
    recursive: true,
  });
  cpSync(path.join(root, 'profiles'), path.join(appDir, 'profiles'), { recursive: true });

  // Install production dependencies in a clean workspace. This keeps the portable
  // build independent of the developer's node_modules.
  const prodDir = path.join(buildDir, 'prod-deps');
  rmSync(prodDir, { recursive: true, force: true });
  mkdirSync(prodDir, { recursive: true });
  for (const file of ['package.json', 'package-lock.json']) {
    copyFileSync(path.join(root, file), path.join(prodDir, file));
  }
  for (const packageName of ['shared', 'profiles', 'core']) {
    mkdirSync(path.join(prodDir, 'packages', packageName), { recursive: true });
    copyFileSync(
      path.join(root, 'packages', packageName, 'package.json'),
      path.join(prodDir, 'packages', packageName, 'package.json'),
    );
  }
  for (const appName of ['api', 'cli', 'web']) {
    mkdirSync(path.join(prodDir, 'apps', appName), { recursive: true });
    copyFileSync(
      path.join(root, 'apps', appName, 'package.json'),
      path.join(prodDir, 'apps', appName, 'package.json'),
    );
  }
  run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: prodDir,
  });
  cpSync(path.join(prodDir, 'node_modules'), path.join(appDir, 'node_modules'), {
    recursive: true,
    dereference: false,
  });

  // Replace workspace symlinks with real directories. Windows zip extraction
  // does not reliably preserve symlinks.
  for (const packageName of ['shared', 'profiles', 'core']) {
    const target = path.join(appDir, 'node_modules', '@ff3mf', packageName);
    rmSync(target, { recursive: true, force: true });
    cpSync(path.join(root, 'packages', packageName), target, {
      recursive: true,
      filter: (source) => !source.includes(`${path.sep}src`) && !source.includes(`${path.sep}test`),
    });
    rmSync(path.join(target, 'tsconfig.json'), { force: true });
  }
  rmSync(path.join(appDir, 'node_modules', '@ff3mf', 'web'), { recursive: true, force: true });

  // The UI is prebuilt; these packages are not needed at runtime.
  for (const packageName of [
    '@ff3mf/web',
    '@fontsource',
    '@fontsource-variable',
    '@playwright',
    '@tailwindcss',
    '@vitejs',
    'react',
    'react-dom',
    'lucide-react',
    'tailwindcss',
    'tailwind-merge',
    'clsx',
    'vite',
  ]) {
    rmSync(path.join(appDir, 'node_modules', packageName), { recursive: true, force: true });
  }

  writeFileSync(
    path.join(appDir, 'PORTABLE-README.txt'),
    `FF-3MF Converter ${version}\n\n` +
      `This folder contains the application, the bundled Node.js runtime and the\n` +
      `conversion profiles. The platform launcher is in the package root.\n\n` +
      `Data is stored in the user's data directory by default. Use --data-dir to\n` +
      `choose another folder. The launcher opens the browser automatically; use\n` +
      `--no-browser when running on a headless machine.\n\n` +
      `Command-line interface (use node.exe on Windows):\n` +
      `  runtime/node app/apps/cli/dist/index.js printers\n`,
  );
}

function writeLauncherReadme(destination, platform) {
  const runCommand = platform === 'win-x64' ? 'FF-3MF.exe' : './ff3mf';
  writeFileSync(
    path.join(destination, 'README.txt'),
    `FF-3MF Converter ${version}\n` +
      `===============================\n\n` +
      `Run:\n  ${runCommand}\n\n` +
      `The launcher starts the local web app and opens it in your browser.\n` +
      `The default address is http://127.0.0.1:8080. If that port is busy,\n` +
      `the next free port is used.\n\n` +
      `Options:\n` +
      `  ${runCommand} --port 9000\n` +
      `  ${runCommand} --no-browser\n` +
      `  ${runCommand} --data-dir /path/to/data\n` +
      `  ${runCommand} --version\n\n` +
      `Data location:\n` +
      (platform === 'win-x64'
        ? `  %LOCALAPPDATA%\\FF-3MF\\data\n`
        : `  $XDG_DATA_HOME/ff3mf or ~/.local/share/ff3mf\n`) +
      `\nNo installation is required. The package includes Node.js ${nodeVersion}.\n` +
      `See LICENSE and THIRD_PARTY_NOTICES.md for licensing information.\n`,
  );
}

function buildLaunchers() {
  const launcherDir = path.join(root, 'packaging', 'launcher');
  const linuxLauncher = path.join(buildDir, 'launchers', 'ff3mf');
  const windowsLauncher = path.join(buildDir, 'launchers', 'FF-3MF.exe');
  const iconResource = path.join(launcherDir, 'rsrc_windows_amd64.syso');
  mkdirSync(path.dirname(linuxLauncher), { recursive: true });
  if (!existsSync(iconResource)) {
    run(
      'go',
      ['run', 'github.com/akavel/rsrc@v0.10.2', '-ico', 'app.ico', '-o', 'rsrc_windows_amd64.syso'],
      {
        cwd: launcherDir,
      },
    );
  }
  for (const [goos, output] of [
    ['linux', linuxLauncher],
    ['windows', windowsLauncher],
  ]) {
    run(
      'go',
      ['build', '-trimpath', '-ldflags', `-s -w -X main.version=${version}`, '-o', output, '.'],
      {
        cwd: launcherDir,
        env: { GOOS: goos, GOARCH: 'amd64', CGO_ENABLED: '0' },
      },
    );
  }
  return { linuxLauncher, windowsLauncher };
}

async function assemble(platform, launchers) {
  const node = await ensureNodeRuntime(platform);
  const folderName = `FF-3MF-Converter-${version}-${platform}`;
  const destination = path.join(stageRoot, folderName);
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });

  cpSync(appDir, path.join(destination, 'app'), { recursive: true });
  mkdirSync(path.join(destination, 'runtime'), { recursive: true });
  const nodeName = platform === 'win-x64' ? 'node.exe' : 'node';
  copyFileSync(node.nodeBinary, path.join(destination, 'runtime', nodeName));
  const nodeLicense = path.join(node.base, 'LICENSE');
  if (existsSync(nodeLicense))
    copyFileSync(nodeLicense, path.join(destination, 'runtime', 'LICENSE'));
  copyFileSync(path.join(root, 'LICENSE'), path.join(destination, 'LICENSE'));
  copyFileSync(
    path.join(root, 'THIRD_PARTY_NOTICES.md'),
    path.join(destination, 'THIRD_PARTY_NOTICES.md'),
  );

  if (platform === 'win-x64') {
    copyFileSync(launchers.windowsLauncher, path.join(destination, 'FF-3MF.exe'));
    copyFileSync(
      path.join(root, 'packaging', 'launcher', 'app.ico'),
      path.join(destination, 'FF-3MF.ico'),
    );
  } else {
    copyFileSync(launchers.linuxLauncher, path.join(destination, 'ff3mf'));
    run('chmod', ['+x', path.join(destination, 'ff3mf')]);
  }
  writeLauncherReadme(destination, platform);

  mkdirSync(artifactDir, { recursive: true });
  const artifact = path.join(
    artifactDir,
    `FF-3MF-Converter-${version}-${platform}${platform === 'win-x64' ? '.zip' : '.tar.gz'}`,
  );
  rmSync(artifact, { force: true });
  if (platform === 'win-x64') {
    run('python3', [
      '-c',
      'import shutil,sys; shutil.make_archive(sys.argv[1], "zip", root_dir=sys.argv[2], base_dir=sys.argv[3])',
      artifact.slice(0, -4),
      stageRoot,
      folderName,
    ]);
  } else {
    run('tar', ['-czf', artifact, '-C', stageRoot, folderName]);
  }
  return artifact;
}

async function main() {
  console.log(`Building FF-3MF portable executables ${version}`);
  rmSync(buildDir, { recursive: true, force: true });
  rmSync(artifactDir, { recursive: true, force: true });
  mkdirSync(buildDir, { recursive: true });

  buildProductionApp();
  const launchers = buildLaunchers();
  const artifacts = [await assemble('win-x64', launchers), await assemble('linux-x64', launchers)];

  const checksums = artifacts
    .map((artifact) => `${sha256(artifact)}  ${path.basename(artifact)}`)
    .join('\n');
  writeFileSync(path.join(artifactDir, 'SHA256SUMS.txt'), `${checksums}\n`);
  console.log('\nArtifacts:');
  for (const artifact of artifacts) {
    console.log(
      `  ${path.relative(root, artifact)} (${(statSync(artifact).size / 1024 / 1024).toFixed(1)} MB)`,
    );
  }
  console.log(`  ${path.relative(root, path.join(artifactDir, 'SHA256SUMS.txt'))}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
