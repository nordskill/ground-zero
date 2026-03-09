import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync, rmSync } from 'node:fs';
import { join, dirname, resolve as pathResolve, relative as pathRelative, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
// @ts-ignore - ejs doesn't have type definitions
import ejs from 'ejs';
import { generateSvgSprite } from './svg-sprite.js';
import { transformHtmlImages } from './responsive-images.js';

const CWD = process.cwd();
const PAGES_DIR = join(CWD, 'src/pages');
const PARTIALS_DIR = join(CWD, 'src/partials');
const DEV_OUT_DIR = join(CWD, 'dev-html');
const ICONS_DIR = join(CWD, 'src/assets/icons');
const SPRITE_PARTIAL = join(CWD, 'src/partials/svg-sprite.ejs');

const MODULE_ENTRY_ABS = join(CWD, 'src/assets/js/main.js');
const MODULE_ENTRY = `/@fs/${MODULE_ENTRY_ABS.replaceAll('\\', '/')}`;

/**
 * Strip EJS comments (<%# ... %>) while preserving line count.
 * @param {string} str - Template content.
 * @returns {string} Content with comments removed.
 */
function stripEjsComments(str) {
    let out = '';
    let i = 0;
    const len = str.length;
    while (i < len) {
        if (str.startsWith('<%#', i)) {
            let depth = 1;
            i += 3;
            while (i < len && depth > 0) {
                if (str.startsWith('<%%', i)) {
                    i += 3;
                } else if (str.startsWith('<%', i)) {
                    depth++;
                    i += 2;
                } else if (str.startsWith('%>', i)) {
                    depth--;
                    i += 2;
                } else {
                    if (str[i] === '\n') {
                        out += '\n';
                    }
                    i++;
                }
            }
        } else {
            out += str[i];
            i++;
        }
    }
    return out;
}

/**
 * Read an EJS file and strip supported EJS comment blocks.
 * @param {string} filePath - Absolute path to the file.
 * @returns {string} File contents without EJS comments.
 */
function readEjsFile(filePath) {
    const content = readFileSync(filePath, 'utf8');
    return stripEjsComments(content);
}

ejs.fileLoader = readEjsFile;

/**
 * Recursively walk a directory and collect `.ejs` files.
 * @param {string} dir - Directory to scan.
 * @returns {string[]} Absolute EJS file paths.
 */
function walkDir(dir) {
    /** @type {string[]} */
    const out = [];
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        const s = statSync(p);
        if (s.isDirectory()) out.push(...walkDir(p));
        else if (p.endsWith('.ejs')) out.push(p);
    }
    return out;
}

/**
 * Read all partials under `src/partials`.
 * @returns {Record<string, string>} Partial name to file content map.
 */
function readPartials() {
    /** @type {Record<string, string>} */
    const map = {};
    if (!existsSync(PARTIALS_DIR)) return map;
    for (const file of walkDir(PARTIALS_DIR)) {
        const key = pathRelative(PARTIALS_DIR, file).replace(/\.ejs$/, '');
        map[key] = readEjsFile(file);
    }
    return map;
}

/**
 * Resolve an include path relative to the file that includes it.
 * @param {string} fromFile - File containing the include.
 * @param {string} includePath - Include path from the template.
 * @returns {string} Absolute resolved path.
 */
function resolveInclude(fromFile, includePath) {
    const base = pathResolve(dirname(fromFile), includePath);
    if (extname(base) === '.ejs') return base;
    const withExt = `${base}.ejs`;
    if (existsSync(withExt)) return withExt;
    if (existsSync(base)) return base;
    return withExt;
}

/**
 * Scan an EJS file and collect its include dependencies.
 * @param {string} filePath - Absolute path to the EJS file.
 * @returns {Set<string>} Absolute paths of included partials.
 */
function scanIncludes(filePath) {
    const src = readEjsFile(filePath);
    const rx = /include\(\s*['"]([^'"]+)['"]/g;
    /** @type {Set<string>} */
    const targets = new Set();
    let m;
    while ((m = rx.exec(src))) {
        const inc = m[1];
        const resolved = resolveInclude(filePath, inc);
        if (existsSync(resolved)) targets.add(resolved);
    }
    return targets;
}

/**
 * Build the include dependency graph for pages and partials.
 * @returns {Promise<{
 *   pages: Set<string>,
 *   partials: Set<string>,
 *   includes: Map<string, Set<string>>,
 *   dependents: Map<string, Set<string>>
 * }>} Graph data used for incremental rebuilds.
 */
export async function buildDependencyGraph() {
    const pages = new Set(walkDir(PAGES_DIR));
    const partials = new Set(walkDir(PARTIALS_DIR));
    const universe = new Set([...pages, ...partials]);

    /** @type {Map<string, Set<string>>} */
    const includes = new Map();
    /** @type {Map<string, Set<string>>} */
    const dependents = new Map();

    for (const file of universe) {
        const incs = scanIncludes(file);
        includes.set(file, incs);
        for (const target of incs) {
            if (!dependents.has(target)) dependents.set(target, new Set());
            const deps = dependents.get(target);
            if (deps) deps.add(file);
        }
    }

    return { pages, partials, includes, dependents };
}

/**
 * Find all pages impacted by a set of changed files.
 * @param {string[]} changedPaths - Changed file paths, relative or absolute.
 * @param {{
 *   pages: Set<string>,
 *   partials: Set<string>,
 *   includes: Map<string, Set<string>>,
 *   dependents: Map<string, Set<string>>
 * }} graph - Dependency graph returned by `buildDependencyGraph()`.
 * @returns {Set<string>} Absolute page paths that should be rebuilt.
 */
export function getImpactedPages(changedPaths, graph) {
    /** @type {Set<string>} */
    const result = new Set();
    /** @type {Set<string>} */
    const seen = new Set();
    /** @type {string[]} */
    const stack = [];

    for (const p of changedPaths) {
        const abs = pathResolve(CWD, p);
        stack.push(abs);
    }

    while (stack.length) {
        const cur = stack.pop();
        if (!cur || seen.has(cur)) continue;
        seen.add(cur);

        if (graph.pages.has(cur)) result.add(cur);

        const ups = graph.dependents.get(cur);
        if (ups) {
            for (const u of ups) {
                if (graph.pages.has(u)) result.add(u);
                if (!seen.has(u)) stack.push(u);
            }
        }
    }

    return result;
}

/**
 * Resolve the output directory for compiled HTML.
 * @param {string | undefined} outDir - Optional explicit output directory.
 * @returns {string} Absolute output directory path.
 */
function getOutDir(outDir) {
    return outDir ? pathResolve(CWD, outDir) : DEV_OUT_DIR;
}

/**
 * Ensure that the HTML output directory exists.
 * @param {string} outDir - Absolute output directory.
 * @returns {void}
 */
function ensureOutDir(outDir) {
    mkdirSync(outDir, { recursive: true });
}

/**
 * Reset the compiled HTML output directory before a full rebuild.
 * @param {string} outDir - Absolute output directory.
 * @returns {void}
 */
function resetOutDir(outDir) {
    rmSync(outDir, { recursive: true, force: true });
    ensureOutDir(outDir);
}

/**
 * Compile a single EJS page using the current partial set.
 * @param {string} pageFileAbs - Absolute page path.
 * @param {Record<string, string>} partials - Partial map from `readPartials()`.
 * @param {string} outDir - Absolute HTML output directory.
 * @param {{
 *   responsiveImages?: boolean,
 *   imageManifest?: Map<string, import('./responsive-images.js').ResponsiveImageEntry>,
 *   imageConfig?: import('./responsive-images.js').ResponsiveImageConfig
 * }} [options] - Optional build-time image transform settings.
 * @returns {void}
 */
function compilePageWithPartials(pageFileAbs, partials, outDir, options) {
    if (!existsSync(pageFileAbs)) return;
    const template = readEjsFile(pageFileAbs);
    const renderedHtml = ejs.render(
        template,
        { partials, moduleEntry: MODULE_ENTRY },
        { root: PAGES_DIR, filename: pageFileAbs }
    );
    const html = transformHtmlImages(renderedHtml, options);
    const rel = pathRelative(PAGES_DIR, pageFileAbs).replace(/\.ejs$/, '.html');
    const outPath = join(outDir, rel);
    const pageOutDir = dirname(outPath);
    mkdirSync(pageOutDir, { recursive: true });
    writeFileSync(outPath, html);
    console.log('Built', outPath);
}

/**
 * Compile one EJS page to HTML.
 * @param {string} pageFileAbs - Absolute page path.
 * @param {string} [outDir] - Optional output directory, defaults to `dev-html/`.
 * @param {{
 *   responsiveImages?: boolean,
 *   imageManifest?: Map<string, import('./responsive-images.js').ResponsiveImageEntry>,
 *   imageConfig?: import('./responsive-images.js').ResponsiveImageConfig
 * }} [options] - Optional build-time image transform settings.
 * @returns {Promise<void>}
 */
export async function compilePage(pageFileAbs, outDir, options) {
    const targetOutDir = getOutDir(outDir);
    ensureOutDir(targetOutDir);
    const partials = readPartials();
    compilePageWithPartials(pageFileAbs, partials, targetOutDir, options);
}

/**
 * Compile all EJS pages to HTML.
 * @param {string} [outDir] - Optional output directory, defaults to `dev-html/`.
 * @param {{
 *   responsiveImages?: boolean,
 *   imageManifest?: Map<string, import('./responsive-images.js').ResponsiveImageEntry>,
 *   imageConfig?: import('./responsive-images.js').ResponsiveImageConfig
 * }} [options] - Optional build-time image transform settings.
 * @returns {Promise<void>}
 */
export async function compileAll(outDir, options) {
    const targetOutDir = getOutDir(outDir);
    await generateSvgSprite(ICONS_DIR, SPRITE_PARTIAL);
    resetOutDir(targetOutDir);
    const partials = readPartials();
    const pages = walkDir(PAGES_DIR);
    for (const page of pages) {
        compilePageWithPartials(page, partials, targetOutDir, options);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    compileAll().catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}
