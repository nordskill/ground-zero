#!/usr/bin/env node
/**
 * ground-zero build CLI:
 * - Compiles EJS pages into an isolated production HTML cache
 * - Runs Vite build with packaged config
 * - Copies static src/assets files into build/assets while Vite emits JS/CSS bundles there too
 * - Generates responsive images from src/assets/images into build/assets/images
 * - Generates sitemap.xml and robots.txt from src/pages metadata
 * - Removes the temporary HTML cache after a successful build
 */
import { spawn } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { resolve as pathResolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { compileAll } from '../scripts/compile-ejs.js';
import { copySourceAssetsToBuild } from '../scripts/assets.js';
import {
    buildResponsiveImageManifest,
    loadImageConversionConfig,
    writeResponsiveImages
} from '../scripts/responsive-images.js';
import { writeSitemapFiles } from '../scripts/sitemap.js';

const DIRNAME = import.meta.dirname;
const PKG_ROOT = pathResolve(DIRNAME, '..');
const require = createRequire(import.meta.url);

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
const buildRoot = pathResolve(process.cwd(), 'build');
const buildAssetsRoot = pathResolve(process.cwd(), 'build', 'assets');
const buildImagesRoot = pathResolve(buildAssetsRoot, 'images');

/**
 * Spawn a Node.js subprocess and forward its stdio.
 * @param {string[]} args - CLI arguments passed to `node`.
 * @param {NodeJS.ProcessEnv} [env] - Optional environment overrides.
 * @returns {Promise<void>} Resolves when the subprocess exits successfully.
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
 * Remove the temporary HTML cache after a successful build.
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

(async () => {
    const imageConfig = await loadImageConversionConfig();
    const imageManifest = await buildResponsiveImageManifest(imageConfig);

    await compileAll(buildHtmlRoot, {
        responsiveImages: true,
        imageManifest,
        imageConfig
    });
    await runNode([viteBin, 'build', '--config', configPath], {
        GZERO_HTML_ROOT: buildHtmlRoot
    });
    copySourceAssetsToBuild(buildAssetsRoot, { skipTopLevelDirs: ['images'] });
    await writeResponsiveImages(imageManifest, buildImagesRoot, imageConfig);
    await writeSitemapFiles(buildRoot);
    await runNode([minifyScript]);
    cleanupTempBuildHtml();
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
