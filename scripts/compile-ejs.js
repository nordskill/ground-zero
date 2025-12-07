import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve as pathResolve, relative as pathRelative, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
// @ts-ignore - ejs doesn't have type definitions
import ejs from 'ejs';

// Base paths
const CWD = process.cwd();
const PAGES_DIR = join(CWD, 'src/pages');
const PARTIALS_DIR = join(CWD, 'src/partials');
const OUT_DIR = join(CWD, 'dev-html');

// Use Vite's /@fs/ to load modules from outside the dev server root (dev-html/)
const MODULE_ENTRY_ABS = join(CWD, 'src/assets/js/main.js');
const MODULE_ENTRY = `/@fs/${MODULE_ENTRY_ABS.replaceAll('\\', '/')}`;

/**
 * Strip EJS comments (<%# ... %>) with support for nested tags.
 * Allows using <%- include(...) %> inside comments.
 * Preserves line numbers by keeping newlines.
 * @param {string} str - Template content
 * @returns {string} Content with comments removed
 */
function stripEjsComments(str) {
    let out = '';
    let i = 0;
    const len = str.length;
    while (i < len) {
        if (str.startsWith('<%#', i)) {
            let depth = 1;
            i += 3; // Skip start tag
            while (i < len && depth > 0) {
                // Check for literal escape <%% - ignore it
                if (str.startsWith('<%%', i)) {
                    i += 3;
                }
                // Check for opening tags <% (including variants)
                else if (str.startsWith('<%', i)) {
                    depth++;
                    i += 2;
                }
                // Check for closing tags %> (including variants like -%>, _%>)
                // Since all end with %>, we just look for that.
                else if (str.startsWith('%>', i)) {
                    depth--;
                    i += 2;
                } else {
                    // Preserve newlines to maintain line numbers in source maps
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
 * Read file and strip EJS comments
 * @param {string} filePath
 * @returns {string}
 */
function readEjsFile(filePath) {
    const content = readFileSync(filePath, 'utf8');
    return stripEjsComments(content);
}

// Override EJS file loader to support custom comment stripping in includes
ejs.fileLoader = readEjsFile;

/**
 * Recursively walk directory and find all .ejs files
 * @param {string} dir - Directory path to walk
 * @returns {string[]} Array of absolute paths to .ejs files
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
 * Read all partial files and return a map of partial names to content
 * @returns {Record<string, string>} Map of partial names to their content
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
 * Resolve include path relative to the including file
 * @param {string} fromFile - Path to the file that includes
 * @param {string} includePath - Relative path to the included file
 * @returns {string} Resolved absolute path
 */
function resolveInclude(fromFile, includePath) {
    // Resolve relative to including file; add .ejs extension if omitted
    const base = pathResolve(dirname(fromFile), includePath);
    if (extname(base) === '.ejs') return base;
    const withExt = `${base}.ejs`;
    if (existsSync(withExt)) return withExt;
    // Fallback to base if it already exists as-is
    if (existsSync(base)) return base;
    return withExt;
}

/**
 * Scan EJS file for include() calls and return set of included file paths
 * @param {string} filePath - Path to the EJS file to scan
 * @returns {Set<string>} Set of absolute paths to included files
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
 * Build a dependency graph of EJS files:
 * - pages: Set of absolute page files
 * - partials: Set of absolute partial files
 * - includes: Map(src -> Set(dst))
 * - dependents: Map(dst -> Set(src)) reverse edges (used to find impacted pages)
 * @returns {Promise<{pages: Set<string>, partials: Set<string>, includes: Map<string, Set<string>>, dependents: Map<string, Set<string>>}>}
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
        for (const t of incs) {
            if (!dependents.has(t)) dependents.set(t, new Set());
            const deps = dependents.get(t);
            if (deps) deps.add(file);
        }
    }

    return { pages, partials, includes, dependents };
}

/**
 * Get all pages impacted by changes to given files
 * @param {string[]} changedPaths - Array of changed file paths (relative or absolute)
 * @param {{pages: Set<string>, partials: Set<string>, includes: Map<string, Set<string>>, dependents: Map<string, Set<string>>}} graph - Dependency graph
 * @returns {Set<string>} Set of absolute paths to impacted pages
 */
export function getImpactedPages(changedPaths, graph) {
    /** @type {Set<string>} */
    const result = new Set();
    /** @type {Set<string>} */
    const seen = new Set();
    /** @type {string[]} */
    const stack = [];

    // Normalize to absolute paths
    for (const p of changedPaths) {
        const abs = pathResolve(CWD, p);
        stack.push(abs);
    }

    while (stack.length) {
        const cur = stack.pop();
        if (!cur || seen.has(cur)) continue;
        seen.add(cur);

        // If a page changed directly, include it
        if (graph.pages.has(cur)) result.add(cur);

        // Traverse reverse edges to find higher-level dependents (pages or partials)
        /** @type {Set<string> | undefined} */
        const ups = graph.dependents.get(cur);
        if (ups) {
            for (const u of ups) {
                if (graph.pages.has(u)) result.add(u);
                // Keep walking up to cover partials included by other partials
                if (!seen.has(u)) stack.push(u);
            }
        }
    }

    return result;
}

function ensureOutDir() {
    mkdirSync(OUT_DIR, { recursive: true });
}

/**
 * Compile a single EJS page with partials
 * @param {string} pageFileAbs - Absolute path to the page file
 * @param {Record<string, string>} partials - Map of partial names to content
 */
function compilePageWithPartials(pageFileAbs, partials) {
    if (!existsSync(pageFileAbs)) return;
    const template = readEjsFile(pageFileAbs);
    const html = ejs.render(
        template,
        { partials, moduleEntry: MODULE_ENTRY },
        { root: PAGES_DIR, filename: pageFileAbs }
    );
    // Preserve directory structure relative to pages dir
    const rel = pathRelative(PAGES_DIR, pageFileAbs).replace(/\.ejs$/, '.html');
    const outPath = join(OUT_DIR, rel);
    const outDir = dirname(outPath);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(outPath, html);
    console.log('Built', outPath);
}

/**
 * Compile a single EJS page
 * @param {string} pageFileAbs - Absolute path to the page file
 * @returns {Promise<void>}
 */
export async function compilePage(pageFileAbs) {
    ensureOutDir();
    const partials = readPartials();
    compilePageWithPartials(pageFileAbs, partials);
}

/**
 * Compile all EJS pages
 * @returns {Promise<void>}
 */
export async function compileAll() {
    ensureOutDir();
    const partials = readPartials();
    const pages = walkDir(PAGES_DIR);
    for (const page of pages) {
        compilePageWithPartials(page, partials);
    }
}

// CLI entry: `node build/compile-ejs.js`
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    compileAll().catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}
