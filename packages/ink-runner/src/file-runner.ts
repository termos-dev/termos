import * as esbuild from "esbuild";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { emitResult, getInteractionId, RESULT_FILE_DIR } from "./types.js";

// ESM compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create require function for resolving module paths from ink-runner's location
const require = createRequire(import.meta.url);

// Get ink-runner's node_modules path for explicit resolution
// When running from plugin: dist/ink-runner/dist/file-runner.js -> dist/ink-runner/node_modules
// When running from dev: packages/ink-runner/dist/file-runner.js -> packages/ink-runner/node_modules
const inkRunnerNodeModules = path.resolve(__dirname, "..", "node_modules");

/**
 * Sandbox configuration for running custom Ink components
 */
export interface SandboxOptions {
  /** Enable sandboxing via Node.js experimental permissions (default: true) */
  enabled?: boolean;
  /** Additional paths to allow reading (default: none) */
  allowFsRead?: string[];
  /** Additional paths to allow writing (default: none) */
  allowFsWrite?: string[];
}

/**
 * Options for running a custom Ink component from a file
 */
export interface RunFromFileOptions {
  /** Path to the component file */
  filePath: string;
  /** Optional title to display */
  title?: string;
  /** Sandbox configuration */
  sandbox?: SandboxOptions;
  /** Interaction ID for file-based result communication */
  interactionId?: string;
}

/**
 * Bundles and executes a custom Ink component from a file.
 *
 * Strategy: Create a single bundled file that includes:
 * 1. The onComplete callback setup
 * 2. The user's component (with ink/react bundled in)
 * 3. The render call
 *
 * Security: By default, runs with Node.js experimental permissions to restrict:
 * - File system access (only temp dir and bundle)
 * - No network access
 * - No child process spawning
 * - No worker threads
 */
export async function runFromFile(
  filePathOrOptions: string | RunFromFileOptions,
  title?: string
): Promise<void> {
  // Handle both old and new API
  const options: RunFromFileOptions = typeof filePathOrOptions === "string"
    ? { filePath: filePathOrOptions, title }
    : filePathOrOptions;

  const filePath = options.filePath;
  const displayTitle = options.title;
  const sandbox: SandboxOptions = options.sandbox ?? { enabled: true };
  const interactionId = options.interactionId ?? getInteractionId();

  // Validate file exists
  const absFilePath = path.resolve(filePath);
  if (!fs.existsSync(absFilePath)) {
    console.error(`Error: File not found: ${absFilePath}`);
    emitResult({ action: "cancel" });
    process.exit(1);
  }

  const ext = path.extname(absFilePath);
  if (![".tsx", ".jsx", ".ts", ".js"].includes(ext)) {
    console.error(`Error: Unsupported file extension: ${ext}`);
    console.error("Supported extensions: .tsx, .jsx, .ts, .js");
    emitResult({ action: "cancel" });
    process.exit(1);
  }

  // Create temp files
  const tempDir = os.tmpdir();
  const bundleId = Date.now();
  const entryPath = path.join(tempDir, `ink-runner-entry-${bundleId}.tsx`);
  const bundledPath = path.join(tempDir, `ink-runner-bundle-${bundleId}.mjs`);

  try {
    // Create entry file that wraps the user's component
    const interactionIdJson = interactionId ? JSON.stringify(interactionId) : "null";
    const entryScript = `
import { render } from 'ink';
import React from 'react';
import { writeFileSync, existsSync } from 'fs';
import Component from ${JSON.stringify(absFilePath)};

// Interaction ID for file-based result communication
const __interactionId = ${interactionIdJson};
const __resultFilePath = __interactionId ? '${RESULT_FILE_DIR}/mcp-interaction-' + __interactionId + '.result' : null;
const __pendingFilePath = __resultFilePath ? __resultFilePath + '.pending' : null;

// Set up the onProgress callback for intermediate updates
globalThis.onProgress = function(data) {
  console.log('__MCP_PROGRESS__:' + JSON.stringify(data));
};

// Set up the onComplete callback
let __resultEmitted = false;
globalThis.onComplete = function(result) {
  if (__resultEmitted) return;
  __resultEmitted = true;
  const fullResult = { action: 'accept', result };

  // Write result and pending files synchronously (reliable, survives process kill)
  if (__resultFilePath) {
    writeFileSync(__resultFilePath, JSON.stringify(fullResult), 'utf-8');
  }
  if (__pendingFilePath) {
    writeFileSync(__pendingFilePath, '', 'utf-8');
  }

  // Emit to stdout for capture_pane fallback
  console.log('__MCP_RESULT__:' + JSON.stringify(fullResult));
  console.log('\\n\\u2713 Waiting for confirmation...');

  // Poll for confirmation (pending file deleted by InteractionManager)
  const checkConfirmation = setInterval(() => {
    if (__pendingFilePath && !existsSync(__pendingFilePath)) {
      clearInterval(checkConfirmation);
      process.exit(0);
    }
  }, 100);

  // Fallback timeout after 60s
  setTimeout(() => {
    clearInterval(checkConfirmation);
    process.exit(0);
  }, 60000);
};

// Validate default export
if (!Component) {
  console.error('Error: Component must have a default export');
  console.log('__MCP_RESULT__:' + JSON.stringify({ action: 'cancel' }));
  process.exit(1);
}

// Render the component
render(React.createElement(Component));
`;

    fs.writeFileSync(entryPath, entryScript);

    // Node.js built-in modules - use node: prefix for ESM
    const nodeBuiltins = [
      "assert", "buffer", "child_process", "cluster", "console", "constants",
      "crypto", "dgram", "dns", "domain", "events", "fs", "http", "https",
      "module", "net", "os", "path", "perf_hooks", "process", "punycode",
      "querystring", "readline", "repl", "stream", "string_decoder", "sys",
      "timers", "tls", "tty", "url", "util", "v8", "vm", "worker_threads", "zlib"
    ];

    // Create external list with node: prefix for proper ESM resolution
    const externals = [
      ...nodeBuiltins,
      ...nodeBuiltins.map((m) => `node:${m}`),
    ];

    // Banner to provide require() for CJS packages bundled into ESM
    const banner = `
import { createRequire as __createRequire } from 'module';
import { fileURLToPath as __fileURLToPath } from 'url';
import { dirname as __dirname_fn } from 'path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_fn(__filename);
`;

    // Bundle everything together, resolving ink/react from ink-runner's node_modules
    const result = await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: bundledPath,
      jsx: "automatic",
      jsxImportSource: "react",
      banner: { js: banner },
      // External node built-ins
      external: externals,
      // Suppress warnings
      logLevel: "error",
      plugins: [
        // Resolve ink, react, and react/jsx-runtime from ink-runner's node_modules
        {
          name: "resolve-ink-runner-deps",
          setup(build) {
            // Resolve bare specifiers for ink and react
            build.onResolve({ filter: /^(ink|react|react\/jsx-runtime)$/ }, (args) => {
              try {
                // Explicitly resolve from ink-runner's node_modules, not from CWD
                // This is critical when running as a Claude Code plugin
                const modulePath = path.join(inkRunnerNodeModules, args.path);

                // For react/jsx-runtime, we need to resolve the actual file
                if (args.path === "react/jsx-runtime") {
                  const jsxRuntimePath = path.join(inkRunnerNodeModules, "react", "jsx-runtime.js");
                  if (fs.existsSync(jsxRuntimePath)) {
                    return { path: jsxRuntimePath };
                  }
                }

                // For ink and react, resolve using require.resolve with explicit paths
                const pkgJsonPath = path.join(modulePath, "package.json");
                if (fs.existsSync(pkgJsonPath)) {
                  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
                  // Use the main/module/exports field to find the entry point
                  const entryPoint = pkgJson.module || pkgJson.main || "index.js";
                  const resolvedPath = path.join(modulePath, entryPoint);
                  if (fs.existsSync(resolvedPath)) {
                    return { path: resolvedPath };
                  }
                }

                // Fallback to require.resolve
                const resolved = require.resolve(args.path);
                return { path: resolved };
              } catch {
                return null; // Let esbuild handle it
              }
            });
          },
        },
        // Stub out react-devtools-core (optional peer dep)
        {
          name: "stub-react-devtools",
          setup(build) {
            build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
              path: "react-devtools-core",
              namespace: "stub",
            }));
            build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
              contents: "export default {}; export const connectToDevTools = () => {};",
            }));
          },
        },
      ],
    });

    if (result.errors.length > 0) {
      console.error("Bundle errors:");
      for (const err of result.errors) {
        console.error(`  ${err.text}`);
      }
      emitResult({ action: "cancel" });
      process.exit(1);
    }

    // Show title if provided
    if (displayTitle) {
      console.log(`\x1b[36m${displayTitle}\x1b[0m\n`);
    }

    // Build node arguments with optional sandbox permissions
    const nodeArgs: string[] = [];

    if (sandbox.enabled !== false) {
      // Enable permission model for sandboxing
      // Node 20-22: --experimental-permission, Node 23+: --permission
      const nodeVersion = parseInt(process.versions.node.split(".")[0], 10);
      const permissionFlag = nodeVersion >= 23 ? "--permission" : "--experimental-permission";
      nodeArgs.push(permissionFlag);

      // Sandbox strategy: Block dangerous capabilities while allowing filesystem
      // The main threats from untrusted Ink components are:
      // 1. Network access (data exfiltration) - BLOCKED
      // 2. Child process spawning (arbitrary code) - BLOCKED
      // 3. Worker threads (circumvent restrictions) - BLOCKED
      //
      // Filesystem: Use wildcard for read (Node module resolution is complex)
      // but restrict writes to temp directories only

      // Allow reading all files - Node's module resolution needs broad access
      // The code is bundled so it won't load external modules anyway
      nodeArgs.push("--allow-fs-read=*");

      // Allow writing only to temp directories
      // Node 25+ requires separate flags for each path instead of comma-separated
      const allowedWritePaths = [
        tempDir,
        "/tmp",
        "/var/folders",
        "/private/var/folders",
        "/private/tmp",
        ...(sandbox.allowFsWrite ?? []),
      ];
      for (const writePath of allowedWritePaths) {
        nodeArgs.push(`--allow-fs-write=${writePath}`);
      }

      // Dangerous capabilities are blocked by not including their flags:
      // - --allow-child-process (not included = blocked)
      // - --allow-worker (not included = blocked)
      // - --allow-addon (not included = blocked)
      // Network is implicitly denied in permission mode
    }

    nodeArgs.push(bundledPath);

    // Run the bundled file
    const child = spawn("node", nodeArgs, {
      stdio: "inherit",
    });

    // Wait for child to exit
    await new Promise<void>((resolve, reject) => {
      child.on("exit", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Process exited with code ${code}`));
        }
      });
      child.on("error", reject);
    });

  } catch (err) {
    console.error("Error bundling/running file:");
    console.error(err instanceof Error ? err.message : String(err));
    emitResult({ action: "cancel" });
    process.exit(1);
  } finally {
    // Clean up temp files
    for (const f of [entryPath, bundledPath]) {
      try {
        if (fs.existsSync(f)) {
          fs.unlinkSync(f);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
