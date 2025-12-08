#!/usr/bin/env node
/**
 * ground-zero dev CLI:
 * - Compiles EJS pages (src/pages -> dev-html)
 * - Starts SVG icons watcher (regenerates sprite on icon changes)
 * - Starts Vite dev server (HMR + browser-sync) with packaged config
 */
import { spawn } from 'node:child_process';
import { resolve as pathResolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { compileAll } from '../scripts/compile-ejs.js';

const DIRNAME = import.meta.dirname;
const PKG_ROOT = pathResolve(DIRNAME, '..');
const require = createRequire(import.meta.url);

// Resolve vite CLI entry via package.json to avoid blocked exports
let viteBin = '';
try {
    const vitePkgPath = require.resolve('vite/package.json');
    viteBin = pathResolve(dirname(vitePkgPath), 'bin', 'vite.js');
} catch {
    console.error('Vite is not installed. Please ensure ground-zero dependencies are installed.');
    process.exit(1);
}

const configPath = pathResolve(PKG_ROOT, 'vite.config.js');
const watchIconsScript = pathResolve(PKG_ROOT, 'scripts/watch-icons.js');

/** @type {import('node:child_process').ChildProcess | null} */
let iconsWatcher = null;

/**
 * Start the SVG icons watcher in the background.
 * @returns {void}
 */
function runIconsWatcher() {
    iconsWatcher = spawn(process.execPath, [watchIconsScript], {
        stdio: 'inherit',
        cwd: process.cwd()
    });
    iconsWatcher.on('error', (err) => {
        console.error('[watch-icons] failed to start:', err.message);
    });
}

/**
 * Start Vite dev server using the packaged config file.
 * @returns {void}
 */
function runViteServe() {
    const child = spawn(process.execPath, [viteBin, 'serve', '--config', configPath], {
        stdio: 'inherit',
        cwd: process.cwd()
    });
    child.on('error', (err) => {
        console.error('[vite] failed to start:', err.message);
        if (iconsWatcher) iconsWatcher.kill();
        process.exit(1);
    });
    child.on('exit', (code) => {
        // Kill icons watcher when Vite exits
        if (iconsWatcher) iconsWatcher.kill();
        process.exit(code ?? 0);
    });
}

/**
 * Entrypoint: compile EJS, start icons watcher, then start the dev server.
 * @returns {Promise<void>}
 */
(async () => {
    // Precompile EJS pages so Vite has HTML inputs
    await compileAll();
    // Start icons watcher in background
    runIconsWatcher();
    // Start Vite dev server (foreground, exits when done)
    runViteServe();
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
