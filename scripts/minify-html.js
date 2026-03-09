import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { minify } from 'html-minifier-terser';

const CWD = process.cwd();
const BUILD_DIR = join(CWD, 'build');

/**
 * Walk `build/` recursively; return HTML file paths only.
 * @param {string} dir
 * @returns {string[]}
 */
function findHtmlFiles(dir) {
    const files = [];
    try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
            const fullPath = join(dir, entry);
            const stat = statSync(fullPath);
            if (stat.isDirectory()) {
                files.push(...findHtmlFiles(fullPath));
            } else if (entry.endsWith('.html')) {
                files.push(fullPath);
            }
        }
    } catch (err) {
        if (err && typeof err === 'object' && 'code' in err && err.code !== 'ENOENT') throw err;
    }
    return files;
}

/**
 * Minify an HTML file by collapsing safe whitespace only.
 * @param {string} filePath - Path to the HTML file to minify.
 * @returns {Promise<void>}
 */
async function minifyHtmlFile(filePath) {
    try {
        const html = readFileSync(filePath, 'utf8');
        const minified = await minify(html, {
            collapseWhitespace: true,
            conservativeCollapse: true
        });
        writeFileSync(filePath, `${minified.trim()}`);
        console.log(`Minified: ${filePath}`);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error minifying ${filePath}:`, message);
        throw err;
    }
}

/**
 * Minify all HTML files in the build directory.
 * @returns {Promise<void>}
 */
async function minifyAllHtml() {
    const htmlFiles = findHtmlFiles(BUILD_DIR);

    if (htmlFiles.length === 0) {
        console.log('No HTML files found in build/ directory');
        return;
    }

    console.log(`Found ${htmlFiles.length} HTML file(s) to minify`);

    for (const file of htmlFiles) {
        await minifyHtmlFile(file);
    }

    console.log('HTML minification complete');
}

// CLI entry: `node scripts/minify-html.js`
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    minifyAllHtml().catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}

