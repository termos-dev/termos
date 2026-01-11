#!/usr/bin/env node
/**
 * Copies runners to dist folder for distribution
 * We copy instead of bundle because ink requires ESM with top-level await
 */

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

function copyDir(src, dest, skipSymlinks = false) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Handle symlinks
    if (entry.isSymbolicLink()) {
      if (skipSymlinks) {
        // Skip symlinks to local packages (they'll be resolved at runtime)
        console.log(`  Skipping symlink: ${entry.name}`);
        continue;
      }
      // Copy the target of the symlink
      const target = fs.readlinkSync(srcPath);
      if (fs.statSync(srcPath).isDirectory()) {
        copyDir(srcPath, destPath, skipSymlinks);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    } else if (entry.isDirectory()) {
      copyDir(srcPath, destPath, skipSymlinks);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function getSize(dir) {
  let size = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      size += getSize(p);
    } else {
      size += fs.statSync(p).size;
    }
  }
  return size;
}

async function bundlePackage(name) {
  const src = path.join(projectRoot, `packages/${name}`);
  const dest = path.join(projectRoot, `dist/${name}`);

  console.log(`\nBuilding ${name}...`);

  // Build the package first
  execFileSync('npm', ['run', 'build'], { cwd: src, stdio: 'inherit' });

  // Install production dependencies
  console.log(`Installing ${name} dependencies...`);
  execFileSync('npm', ['install', '--omit=dev'], { cwd: src, stdio: 'inherit' });

  console.log(`Copying ${name} to dist...`);

  // Remove existing
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true });
  }

  // Copy dist folder
  copyDir(path.join(src, 'dist'), path.join(dest, 'dist'));

  // Copy node_modules (skip symlinks to local packages - they're resolved via dist/)
  copyDir(path.join(src, 'node_modules'), path.join(dest, 'node_modules'), true);

  // Copy package.json
  fs.copyFileSync(
    path.join(src, 'package.json'),
    path.join(dest, 'package.json')
  );

  // Copy built-in components (for ink-runner)
  const componentsDir = path.join(src, 'components');
  if (fs.existsSync(componentsDir)) {
    copyDir(componentsDir, path.join(dest, 'components'));
  }

  const totalSize = getSize(dest);
  console.log(`Copied to: ${dest}`);
  console.log(`Size: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
}

async function bundle() {
  // Build shared first (dependencies need it)
  await bundlePackage('shared');

  // Build ink-runner (clack-runner has been removed)
  await bundlePackage('ink-runner');

  // Copy shared into node_modules so imports can resolve @termosdev/shared
  console.log('\nLinking shared package...');
  const sharedDist = path.join(projectRoot, 'dist/shared');

  // Link to main dist/node_modules for the CLI
  const mainSharedDest = path.join(projectRoot, 'dist/node_modules/@termosdev/shared');
  if (fs.existsSync(mainSharedDest)) {
    fs.rmSync(mainSharedDest, { recursive: true });
  }
  fs.mkdirSync(path.dirname(mainSharedDest), { recursive: true });
  copyDir(sharedDist, mainSharedDest);
  console.log('  Linked shared to dist/node_modules');

  // Link to ink-runner's node_modules
  const runnerSharedDest = path.join(projectRoot, 'dist/ink-runner/node_modules/@termosdev/shared');
  if (fs.existsSync(runnerSharedDest)) {
    fs.rmSync(runnerSharedDest, { recursive: true });
  }
  fs.mkdirSync(path.dirname(runnerSharedDest), { recursive: true });
  copyDir(sharedDist, runnerSharedDest);
  console.log('  Linked shared to ink-runner');

  console.log('\nBundle complete!');
}

bundle().catch((err) => {
  console.error('Bundle failed:', err);
  process.exit(1);
});
