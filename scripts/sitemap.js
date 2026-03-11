import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    statSync,
    writeFileSync
} from 'node:fs';
import { join, relative as pathRelative, resolve as pathResolve } from 'node:path';
import { loadProjectConfig } from './project-config.js';
import { assertNoPageOutputCollisions, getPagePathInfo } from './page-paths.js';

const CWD = process.cwd();
const PAGES_DIR = pathResolve(CWD, 'src/pages');
const SITEMAP_BLOCK_TAG = '@ground-zero-sitemap';
const CHANGEFREQ_VALUES = new Set([
    'always',
    'hourly',
    'daily',
    'weekly',
    'monthly',
    'yearly',
    'never'
]);

/**
 * @typedef {'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'} SitemapChangefreq
 */

/**
 * @typedef {Object} SitemapMeta
 * @property {boolean | undefined} [exclude]
 * @property {SitemapChangefreq | undefined} [changefreq]
 * @property {number | undefined} [priority]
 */

/**
 * @typedef {Object} SitemapBuildConfig
 * @property {string} siteUrl
 * @property {{ changefreq: SitemapChangefreq, priority: number }} defaults
 * @property {string[]} robotsDisallow
 */

/**
 * Normalize Windows separators for URL usage.
 * @param {string} value - File path or URL fragment.
 * @returns {string} Value with forward slashes.
 */
function normalizeSlashes(value) {
    return value.replaceAll('\\', '/');
}

/**
 * Escape XML-sensitive characters in a text node.
 * @param {string} value - Raw XML text.
 * @returns {string} Escaped XML-safe text.
 */
function escapeXml(value) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}

/**
 * Check whether a value is a plain object.
 * @param {unknown} value - Unknown runtime value.
 * @returns {value is Record<string, unknown>} `true` when the value is a plain object.
 */
function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate a sitemap metadata object.
 * @param {Record<string, unknown>} input - Raw metadata object.
 * @param {string} label - Human-readable source label for error messages.
 * @param {{ allowExclude: boolean }} options - Validation options.
 * @returns {SitemapMeta} Sanitized metadata.
 */
function validateSitemapMeta(input, label, options) {
    const allowedKeys = options.allowExclude
        ? new Set(['exclude', 'changefreq', 'priority'])
        : new Set(['changefreq', 'priority']);

    for (const key of Object.keys(input)) {
        if (!allowedKeys.has(key)) {
            throw new Error(`Unsupported sitemap key "${key}" in ${label}`);
        }
    }

    /** @type {SitemapMeta} */
    const meta = {};

    if ('exclude' in input) {
        if (!options.allowExclude) {
            throw new Error(`"exclude" is not allowed in ${label}`);
        }
        if (typeof input.exclude !== 'boolean') {
            throw new Error(`Expected "exclude" to be boolean in ${label}`);
        }
        meta.exclude = input.exclude;
    }

    if ('changefreq' in input) {
        if (typeof input.changefreq !== 'string' || !CHANGEFREQ_VALUES.has(input.changefreq)) {
            throw new Error(`Invalid "changefreq" in ${label}`);
        }
        meta.changefreq = /** @type {SitemapChangefreq} */ (input.changefreq);
    }

    if ('priority' in input) {
        if (
            typeof input.priority !== 'number'
            || !Number.isFinite(input.priority)
            || input.priority < 0
            || input.priority > 1
        ) {
            throw new Error(`Invalid "priority" in ${label}; expected a number between 0 and 1`);
        }
        meta.priority = input.priority;
    }

    return meta;
}

/**
 * Normalize and validate the configured site URL.
 * @param {string} siteUrl - Raw site URL from config.
 * @returns {string} Canonical site URL without a trailing slash.
 */
function normalizeSiteUrl(siteUrl) {
    let url;
    try {
        url = new URL(siteUrl);
    } catch {
        throw new Error(`Invalid "siteUrl" in ground-zero config: ${siteUrl}`);
    }

    if (!/^https?:$/.test(url.protocol)) {
        throw new Error(`Invalid "siteUrl" protocol in ground-zero config: ${siteUrl}`);
    }

    if (url.search || url.hash) {
        throw new Error('"siteUrl" in ground-zero config must not contain query or hash segments');
    }

    const pathname = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${pathname}`;
}

/**
 * Load sitemap-related settings from project config.
 * @returns {Promise<SitemapBuildConfig>} Effective sitemap configuration.
 */
async function loadSitemapBuildConfig() {
    const userConfig = await loadProjectConfig();
    const rawSiteUrl = typeof userConfig.siteUrl === 'string' ? userConfig.siteUrl.trim() : '';
    if (!rawSiteUrl) {
        throw new Error('Missing "siteUrl" in ground-zero config; sitemap generation requires it');
    }

    const sitemapConfigValue = userConfig.sitemap;
    if (sitemapConfigValue !== undefined && !isPlainObject(sitemapConfigValue)) {
        throw new Error('Expected "sitemap" in ground-zero config to be an object');
    }
    const sitemapConfig = sitemapConfigValue;

    const rawDefaults = sitemapConfig ? sitemapConfig.defaults : undefined;
    if (rawDefaults !== undefined && !isPlainObject(rawDefaults)) {
        throw new Error('Expected "sitemap.defaults" in ground-zero config to be an object');
    }

    const robotsConfigValue = userConfig.robots;
    if (robotsConfigValue !== undefined && !isPlainObject(robotsConfigValue)) {
        throw new Error('Expected "robots" in ground-zero config to be an object');
    }
    const robotsConfig = robotsConfigValue;

    const rawRobotsDisallow = robotsConfig ? robotsConfig.disallow : undefined;
    if (
        rawRobotsDisallow !== undefined
        && (
            !Array.isArray(rawRobotsDisallow)
            || rawRobotsDisallow.some((entry) => typeof entry !== 'string' || !entry.trim())
        )
    ) {
        throw new Error('Expected "robots.disallow" in ground-zero config to be a string array');
    }

    const defaults = validateSitemapMeta(rawDefaults ?? {}, '"sitemap.defaults"', { allowExclude: false });

    return {
        siteUrl: normalizeSiteUrl(rawSiteUrl),
        defaults: {
            changefreq: defaults.changefreq ?? 'monthly',
            priority: defaults.priority ?? 0.5
        },
        robotsDisallow: rawRobotsDisallow?.map((entry) => entry.trim()) ?? ['/*.md$']
    };
}

/**
 * Recursively collect `.ejs` page files under `src/pages`.
 * @param {string} dir - Directory to scan.
 * @returns {string[]} Absolute page file paths.
 */
function walkPageFiles(dir) {
    /** @type {string[]} */
    const pages = [];
    if (!existsSync(dir)) return pages;

    for (const entry of readdirSync(dir)) {
        const entryPath = join(dir, entry);
        const stats = statSync(entryPath);
        if (stats.isDirectory()) {
            pages.push(...walkPageFiles(entryPath));
            continue;
        }

        if (entryPath.endsWith('.ejs')) {
            pages.push(entryPath);
        }
    }

    return pages;
}

/**
 * Turn a page file path into its public route.
 * @param {string} pageFile - Absolute page file path.
 * @returns {string} Public route path.
 */
function getPageRoute(pageFile) {
    return getPagePathInfo(PAGES_DIR, pageFile).route;
}

/**
 * Join a route path to the configured site URL without losing path prefixes.
 * @param {string} siteUrl - Canonical site URL.
 * @param {string} route - Public route path.
 * @returns {string} Absolute page URL.
 */
function toAbsolutePageUrl(siteUrl, route) {
    return route === '/' ? `${siteUrl}/` : `${siteUrl}${route}`;
}

/**
 * Read per-page sitemap metadata from an EJS comment block.
 * @param {string} pageFile - Absolute page file path.
 * @returns {SitemapMeta} Parsed page metadata.
 */
function readPageSitemapMeta(pageFile) {
    const source = readFileSync(pageFile, 'utf8');
    const displayPath = normalizeSlashes(pathRelative(CWD, pageFile));
    const blockMatches = source.matchAll(/<%#([\s\S]*?)%>/g);
    /** @type {SitemapMeta | null} */
    let meta = null;

    for (const match of blockMatches) {
        const block = match[1];
        const tagIndex = block.indexOf(SITEMAP_BLOCK_TAG);
        if (tagIndex === -1) continue;

        if (meta) {
            throw new Error(`Multiple ${SITEMAP_BLOCK_TAG} blocks found in ${displayPath}`);
        }

        const rawJson = block.slice(tagIndex + SITEMAP_BLOCK_TAG.length).trim();
        if (!rawJson) {
            throw new Error(`Missing JSON payload after ${SITEMAP_BLOCK_TAG} in ${displayPath}`);
        }

        let parsed;
        try {
            parsed = JSON.parse(rawJson);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Invalid ${SITEMAP_BLOCK_TAG} JSON in ${displayPath}: ${message}`);
        }

        if (!isPlainObject(parsed)) {
            throw new Error(`Expected ${SITEMAP_BLOCK_TAG} metadata to be an object in ${displayPath}`);
        }

        meta = validateSitemapMeta(parsed, `${SITEMAP_BLOCK_TAG} in ${displayPath}`, { allowExclude: true });
    }

    return meta ?? {};
}

/**
 * Build sitemap entry objects from the page tree.
 * @param {SitemapBuildConfig} config - Effective sitemap configuration.
 * @returns {Array<{ loc: string, lastmod: string, changefreq: SitemapChangefreq, priority: number }>}
 * Sitemap URL entries.
 */
function buildSitemapEntries(config) {
    const pageFiles = walkPageFiles(PAGES_DIR).sort((leftPage, rightPage) => {
        const leftRoute = getPageRoute(leftPage);
        const rightRoute = getPageRoute(rightPage);

        if (leftRoute === rightRoute) return 0;
        if (leftRoute === '/') return -1;
        if (rightRoute === '/') return 1;

        return leftRoute.localeCompare(rightRoute);
    });
    assertNoPageOutputCollisions(PAGES_DIR, pageFiles);
    /** @type {Array<{ loc: string, lastmod: string, changefreq: SitemapChangefreq, priority: number }>} */
    const entries = [];

    for (const pageFile of pageFiles) {
        const meta = readPageSitemapMeta(pageFile);
        if (meta.exclude) continue;

        const route = getPageRoute(pageFile);
        const stats = statSync(pageFile);

        entries.push({
            loc: toAbsolutePageUrl(config.siteUrl, route),
            lastmod: stats.mtime.toISOString(),
            changefreq: meta.changefreq ?? config.defaults.changefreq,
            priority: meta.priority ?? config.defaults.priority
        });
    }

    return entries;
}

/**
 * Render sitemap XML from collected page entries.
 * @param {Array<{ loc: string, lastmod: string, changefreq: SitemapChangefreq, priority: number }>} entries
 * Sitemap entries.
 * @returns {string} XML sitemap contents.
 */
function renderSitemapXml(entries) {
    /** @type {string[]} */
    const lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    ];

    for (const entry of entries) {
        lines.push('    <url>');
        lines.push(`        <loc>${escapeXml(entry.loc)}</loc>`);
        lines.push(`        <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
        lines.push(`        <changefreq>${entry.changefreq}</changefreq>`);
        lines.push(`        <priority>${String(entry.priority)}</priority>`);
        lines.push('    </url>');
    }

    lines.push('</urlset>');
    return `${lines.join('\n')}\n`;
}

/**
 * Render the generated robots.txt contents.
 * @param {SitemapBuildConfig} config - Effective sitemap configuration.
 * @returns {string} robots.txt contents.
 */
function renderRobotsTxt(config) {
    /** @type {string[]} */
    const lines = [
        'User-agent: *',
        'Allow: /',
        ''
    ];

    for (const pattern of config.robotsDisallow) {
        lines.push(`Disallow: ${pattern}`);
    }

    lines.push('');
    lines.push(`Sitemap: ${config.siteUrl}/sitemap.xml`);

    return `${lines.join('\n')}\n`;
}

/**
 * Generate `sitemap.xml` and `robots.txt` into the build root.
 * @param {string} outDir - Absolute output directory, usually `build/`.
 * @returns {Promise<void>}
 */
export async function writeSitemapFiles(outDir) {
    const config = await loadSitemapBuildConfig();
    const entries = buildSitemapEntries(config);

    mkdirSync(outDir, { recursive: true });
    writeFileSync(pathResolve(outDir, 'sitemap.xml'), renderSitemapXml(entries));
    writeFileSync(pathResolve(outDir, 'robots.txt'), renderRobotsTxt(config));

    console.log(`[sitemap] wrote ${entries.length} URL entries`);
    console.log('[robots] wrote robots.txt');
}
