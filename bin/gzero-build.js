#!/usr/bin/env node
/**
 * ground-zero build CLI:
 * - Compiles EJS pages into an isolated production HTML cache
 * - Runs Vite build with packaged config
 * - Minifies CSS in build/
 * - Removes the temporary HTML cache after a successful build
 */
import { spawn } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { resolve as pathResolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { compileAll } from '../scripts/compile-ejs.js';
import {
    buildResponsiveImageManifest,
    loadImageConversionConfig,
    writeResponsiveImages
} from '../scripts/responsive-images.js';

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
const tempRoot = pathResolve(process.cwd(), 'tmp');
const buildHtmlRoot = pathResolve(process.cwd(), 'tmp', 'build-html');
const buildImagesRoot = pathResolve(process.cwd(), 'build', 'images');

/**
 * Spawn a Node.js process with the provided arguments.
 * @param {string[]} args - Arguments to pass to the Node executable.
 * @param {NodeJS.ProcessEnv} [env] - Extra environment variables for the child process.
 * @returns {Promise<void>} Resolves when the child exits with code 0.
 */
function runNode(args, env) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, {
            stdio: 'inherit',
            cwd: process.cwd(),
            env: env ? { ...process.env, ...env } : process.env
        });
        child.on('exit', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Command failed with exit code ${code}`));
        });
    });
}

/**
 * Remove the temporary production HTML cache after a successful build.
 * Keeps the cache on failure to make post-mortem inspection possible.
 * @returns {void}
 */
function cleanupTempBuildHtml() {
    rmSync(buildHtmlRoot, { recursive: true, force: true });
    try {
        if (readdirSync(tempRoot).length === 0) {
            rmSync(tempRoot, { recursive: true, force: true });
        }
    } catch {
        // Ignore cleanup follow-up errors; build output is already complete.
    }
}

/**
 * Execute the build pipeline: compile EJS, Vite build, CSS minification.
 * @returns {Promise<void>}
 */
(async () => {
    const imageConfig = await loadImageConversionConfig();
    const imageManifest = await buildResponsiveImageManifest(imageConfig);
    // Precompile EJS pages
    await compileAll(buildHtmlRoot, {
        responsiveImages: true,
        imageManifest,
        imageConfig
    });
    // Build with Vite using packaged config
    await runNode([viteBin, 'build', '--config', configPath], {
        GZERO_HTML_ROOT: buildHtmlRoot
    });
    await writeResponsiveImages(imageManifest, buildImagesRoot, imageConfig);
    // Minify CSS in build/
    await runNode([minifyScript]);
    cleanupTempBuildHtml();
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
