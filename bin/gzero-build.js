#!/usr/bin/env node
/**
 * ground-zero build CLI:
 * - Compiles EJS pages (src/pages -> dev-html)
 * - Runs Vite build with packaged config
 * - Minifies CSS in build/
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
const minifyScript = pathResolve(PKG_ROOT, 'scripts', 'minify-css.js');

/**
 * Spawn a Node.js process with the provided arguments.
 * @param {string[]} args - Arguments to pass to the Node executable.
 * @returns {Promise<void>} Resolves when the child exits with code 0.
 */
function runNode(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, {
            stdio: 'inherit',
            cwd: process.cwd()
        });
        child.on('exit', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Command failed with exit code ${code}`));
        });
    });
}

/**
 * Execute the build pipeline: compile EJS, Vite build, CSS minification.
 * @returns {Promise<void>}
 */
(async () => {
    // Precompile EJS pages
    await compileAll();
    // Build with Vite using packaged config
    await runNode([viteBin, 'build', '--config', configPath]);
    // Minify CSS in build/
    await runNode([minifyScript]);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
