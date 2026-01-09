#!/usr/bin/env node
/**
 * Copies ink-runner to dist folder for distribution
 * We copy instead of bundle because ink requires ESM with top-level await
 */

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function bundle() {
  const inkRunnerSrc = path.join(projectRoot, 'packages/ink-runner');
  const inkRunnerDest = path.join(projectRoot, 'dist/ink-runner');

  console.log('Building ink-runner...');

  // Build ink-runner first using execFileSync (safer than execSync)
  execFileSync('npm', ['run', 'build'], { cwd: inkRunnerSrc, stdio: 'inherit' });

  // Install production dependencies
  console.log('Installing ink-runner dependencies...');
  execFileSync('npm', ['install', '--omit=dev'], { cwd: inkRunnerSrc, stdio: 'inherit' });

  console.log('Copying ink-runner to dist...');

  // Remove existing
  if (fs.existsSync(inkRunnerDest)) {
    fs.rmSync(inkRunnerDest, { recursive: true });
  }

  // Copy dist folder
  copyDir(path.join(inkRunnerSrc, 'dist'), path.join(inkRunnerDest, 'dist'));

  // Copy node_modules
  copyDir(path.join(inkRunnerSrc, 'node_modules'), path.join(inkRunnerDest, 'node_modules'));

  // Copy package.json
  fs.copyFileSync(
    path.join(inkRunnerSrc, 'package.json'),
    path.join(inkRunnerDest, 'package.json')
  );

  // Copy built-in components
  const componentsDir = path.join(inkRunnerSrc, 'components');
  if (fs.existsSync(componentsDir)) {
    copyDir(componentsDir, path.join(inkRunnerDest, 'components'));
  }

  // Calculate size
  const getSize = (dir) => {
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
  };

  const totalSize = getSize(inkRunnerDest);
  console.log(`Copied to: ${inkRunnerDest}`);
  console.log(`Total size: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
}

bundle().catch((err) => {
  console.error('Bundle failed:', err);
  process.exit(1);
});
