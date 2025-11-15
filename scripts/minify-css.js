import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const CWD = process.cwd();
const BUILD_DIR = join(CWD, 'build');

/**
 * Recursively find all CSS files in a directory
 * @param {string} dir - Directory path to search
 * @returns {string[]} Array of absolute paths to CSS files
 */
function findCssFiles(dir) {
    /** @type {string[]} */
    const files = [];
    try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
            const fullPath = join(dir, entry);
            const stat = statSync(fullPath);
            if (stat.isDirectory()) {
                files.push(...findCssFiles(fullPath));
            } else if (entry.endsWith('.css')) {
                files.push(fullPath);
            }
        }
    } catch (err) {
        if (err && typeof err === 'object' && 'code' in err && err.code !== 'ENOENT') throw err;
    }
    return files;
}

/**
 * Minify a CSS file using esbuild
 * @param {string} filePath - Path to the CSS file to minify
 * @returns {Promise<void>}
 */
async function minifyCssFile(filePath) {
    try {
        const css = readFileSync(filePath, 'utf8');
        const result = await esbuild.transform(css, {
            loader: 'css',
            minify: true
        });
        writeFileSync(filePath, result.code);
        console.log(`Minified: ${filePath}`);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error minifying ${filePath}:`, message);
        throw err;
    }
}

/**
 * Minify all CSS files in the build directory
 * @returns {Promise<void>}
 */
async function minifyAllCss() {
    const cssFiles = findCssFiles(BUILD_DIR);
    
    if (cssFiles.length === 0) {
        console.log('No CSS files found in build/ directory');
        return;
    }
    
    console.log(`Found ${cssFiles.length} CSS file(s) to minify`);
    
    for (const file of cssFiles) {
        await minifyCssFile(file);
    }
    
    console.log('CSS minification complete');
}

// CLI entry: `node scripts/minify-css.js`
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    minifyAllCss().catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}

