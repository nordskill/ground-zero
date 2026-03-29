import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync, rmSync } from 'node:fs';
import { join, dirname, resolve as pathResolve, relative as pathRelative, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
// @ts-ignore - ejs doesn't have type definitions
import ejs from 'ejs';
import { generateSvgSprite } from './svg-sprite.js';
import { transformHtmlImages } from './responsive-images.js';
import { assertNoPageOutputCollisions, getPagePathInfo } from './page-paths.js';

const CWD = process.cwd();
const PAGES_DIR = join(CWD, 'src/pages');
const PARTIALS_DIR = join(CWD, 'src/partials');
const DATA_DIR = join(CWD, 'src/data');
const DEV_OUT_DIR = join(CWD, 'dev-html');
const ICONS_DIR = join(CWD, 'src/assets/icons');
const SPRITE_PARTIAL = join(CWD, 'src/partials/svg-sprite.ejs');

const MODULE_ENTRY_ABS = join(CWD, 'src/assets/js/main.js');
const MODULE_ENTRY = `/@fs/${MODULE_ENTRY_ABS.replaceAll('\\', '/')}`;

/**
 * @typedef {Record<string, unknown>} PlainObject
 */

/**
 * Create a plain key-value object without a prototype.
 * @returns {PlainObject} Empty object for template data storage.
 */
function createPlainObject() {
    return /** @type {PlainObject} */ (Object.create(null));
}

/**
 * Check whether an object has a direct property.
 * @param {PlainObject} value - Object to inspect.
 * @param {string} key - Property name.
 * @returns {boolean} `true` when the property exists directly on the object.
 */
function hasOwnKey(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

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
 * Recursively walk a directory and collect files with the given extension.
 * @param {string} dir - Directory to scan.
 * @param {string} extension - File extension to collect.
 * @returns {string[]} Absolute file paths.
 */
function walkDirByExtension(dir, extension) {
    /** @type {string[]} */
    const filePaths = [];
    if (!existsSync(dir)) return filePaths;
    for (const entry of readdirSync(dir)) {
        const entryPath = join(dir, entry);
        const entryStats = statSync(entryPath);
        if (entryStats.isDirectory()) {
            filePaths.push(...walkDirByExtension(entryPath, extension));
        } else if (entryPath.endsWith(extension)) {
            filePaths.push(entryPath);
        }
    }
    return filePaths;
}

/**
 * Read all partials under `src/partials`.
 * @returns {Record<string, string>} Partial name to file content map.
 */
function readPartials() {
    /** @type {Record<string, string>} */
    const map = {};
    if (!existsSync(PARTIALS_DIR)) return map;
    for (const file of walkDirByExtension(PARTIALS_DIR, '.ejs')) {
        const key = pathRelative(PARTIALS_DIR, file).replace(/\.ejs$/, '');
        map[key] = readEjsFile(file);
    }
    return map;
}

/**
 * Check whether a value is a plain object.
 * @param {unknown} value - Runtime value to validate.
 * @returns {value is PlainObject} `true` when the value is a plain object.
 */
function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Read and parse a JSON file from `src/data`.
 * @param {string} filePath - Absolute JSON file path.
 * @returns {unknown} Parsed JSON value.
 */
function readJsonFile(filePath) {
    const rawContent = readFileSync(filePath, 'utf8');

    try {
        return JSON.parse(rawContent);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid JSON in ${filePath}: ${errorMessage}`);
    }
}

/**
 * Store a JSON value at a nested object path.
 * @param {PlainObject} rootObject - Destination object.
 * @param {string[]} pathSegments - Nested key path.
 * @param {unknown} value - Parsed JSON value.
 * @param {string} sourcePath - Source file path for error reporting.
 * @returns {void}
 */
function assignDataValue(rootObject, pathSegments, value, sourcePath) {
    /** @type {PlainObject} */
    let currentLevel = rootObject;

    for (let index = 0; index < pathSegments.length - 1; index++) {
        const segment = pathSegments[index];

        if (!hasOwnKey(currentLevel, segment)) {
            currentLevel[segment] = createPlainObject();
        } else if (!isPlainObject(currentLevel[segment])) {
            const collisionPath = pathSegments.slice(0, index + 1).join('.');
            throw new Error(`Global data path collision in ${sourcePath}: "${collisionPath}" is already defined as a non-object value.`);
        }

        currentLevel = /** @type {PlainObject} */ (currentLevel[segment]);
    }

    const finalSegment = pathSegments[pathSegments.length - 1];
    if (hasOwnKey(currentLevel, finalSegment)) {
        const collisionPath = pathSegments.join('.');
        throw new Error(`Global data path collision in ${sourcePath}: "${collisionPath}" is already defined by another JSON file.`);
    }

    currentLevel[finalSegment] = value;
}

/**
 * Read all JSON files under `src/data` and expose them as a nested object tree.
 * Example: `src/data/company/contact.json` becomes `globalData.company.contact`.
 * @returns {PlainObject} Nested global template data.
 */
function readGlobalData() {
    const globalData = createPlainObject();

    if (!existsSync(DATA_DIR)) return globalData;

    const jsonFiles = walkDirByExtension(DATA_DIR, '.json');
    for (const filePath of jsonFiles) {
        const relativePath = pathRelative(DATA_DIR, filePath).replaceAll('\\', '/');
        const pathSegments = relativePath.replace(/\.json$/i, '').split('/');
        const jsonValue = readJsonFile(filePath);
        assignDataValue(globalData, pathSegments, jsonValue, filePath);
    }

    return globalData;
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
    const pages = new Set(walkDirByExtension(PAGES_DIR, '.ejs'));
    const partials = new Set(walkDirByExtension(PARTIALS_DIR, '.ejs'));
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

    for (const changedPath of changedPaths) {
        const absolutePath = pathResolve(CWD, changedPath);
        stack.push(absolutePath);
    }

    while (stack.length) {
        const currentPath = stack.pop();
        if (!currentPath || seen.has(currentPath)) continue;
        seen.add(currentPath);

        if (graph.pages.has(currentPath)) result.add(currentPath);

        const upstreamDependents = graph.dependents.get(currentPath);
        if (upstreamDependents) {
            for (const dependentPath of upstreamDependents) {
                if (graph.pages.has(dependentPath)) result.add(dependentPath);
                if (!seen.has(dependentPath)) stack.push(dependentPath);
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
 * @param {PlainObject} globalData - Nested JSON data exposed to all templates.
 * @param {string} outDir - Absolute HTML output directory.
 * @param {{
 *   responsiveImages?: boolean,
 *   imageManifest?: Map<string, import('./responsive-images.js').ResponsiveImageEntry>,
 *   imageConfig?: import('./responsive-images.js').ResponsiveImageConfig
 * }} [options] - Optional build-time image transform settings.
 * @returns {void}
 */
function compilePageWithPartials(pageFileAbs, partials, globalData, outDir, options) {
    if (!existsSync(pageFileAbs)) return;
    const template = readEjsFile(pageFileAbs);
    const renderedHtml = ejs.render(
        template,
        { globalData, partials, moduleEntry: MODULE_ENTRY },
        { root: PAGES_DIR, filename: pageFileAbs }
    );
    const html = transformHtmlImages(renderedHtml, options);
    const pageInfo = getPagePathInfo(PAGES_DIR, pageFileAbs);
    const outPath = join(outDir, pageInfo.outputRelativePath);
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
    const globalData = readGlobalData();
    assertNoPageOutputCollisions(PAGES_DIR, walkDirByExtension(PAGES_DIR, '.ejs'));
    compilePageWithPartials(pageFileAbs, partials, globalData, targetOutDir, options);
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
    const globalData = readGlobalData();
    const pages = walkDirByExtension(PAGES_DIR, '.ejs');
    assertNoPageOutputCollisions(PAGES_DIR, pages);
    for (const page of pages) {
        compilePageWithPartials(page, partials, globalData, targetOutDir, options);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    compileAll().catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}
