import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    rmSync,
    statSync
} from 'node:fs';
import {
    basename,
    dirname,
    extname,
    join,
    relative as pathRelative,
    resolve as pathResolve,
    sep
} from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const CWD = process.cwd();
const SOURCE_IMAGES_DIR = pathResolve(CWD, 'src/assets/images');
const CONFIG_FILES = [
    'gzero.config.js',
    'gzero.config.mjs',
    'ground-zero.config.js',
    'ground-zero.config.mjs'
];
/** @type {Readonly<ResponsiveImageConfig>} */
const DEFAULT_IMAGE_CONVERSION_CONFIG = Object.freeze({
    /** @type {keyof import('sharp').FormatEnum} */
    format: 'webp',
    sizes: [480, 960, 1440],
    injectIntrinsicSize: true
});
const IMG_TAG_RX = /<img\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
const IMG_ATTR_RX = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/**
 * @typedef {Object} ResponsiveImageConfig
 * @property {keyof import('sharp').FormatEnum} format
 * @property {number | undefined} [quality]
 * @property {number[]} sizes
 * @property {boolean} injectIntrinsicSize
 */

/**
 * @typedef {Object} ResponsiveVariant
 * @property {number} width
 * @property {number} height
 * @property {string} relativePath
 * @property {string} url
 */

/**
 * @typedef {Object} ResponsiveImageEntryBase
 * @property {'responsive' | 'passthrough'} mode
 * @property {string} sourcePath
 * @property {string} outputPath
 * @property {string} url
 */

/**
 * @typedef {ResponsiveImageEntryBase & {
 *   mode: 'passthrough'
 * }} ResponsivePassthroughImageEntry
 */

/**
 * @typedef {ResponsiveImageEntryBase & {
 *   mode: 'responsive',
 *   sourceWidth: number,
 *   sourceHeight: number,
 *   variants: ResponsiveVariant[]
 * }} ResponsiveGeneratedImageEntry
 */

/**
 * @typedef {ResponsivePassthroughImageEntry | ResponsiveGeneratedImageEntry} ResponsiveImageEntry
 */

/**
 * @typedef {Object} ParsedImgAttribute
 * @property {string} name
 * @property {string | null} value
 * @property {'"' | "'"} quote
 */

/**
 * Keep image lookups scoped to src/assets/images.
 * @param {string} filePath
 * @returns {boolean}
 */
function isSourceImagePath(filePath) {
    return filePath === SOURCE_IMAGES_DIR || filePath.startsWith(`${SOURCE_IMAGES_DIR}${sep}`);
}

/**
 * Normalize Windows separators for URLs.
 * @param {string} value
 * @returns {string}
 */
function normalizeSlashes(value) {
    return value.replaceAll('\\', '/');
}

/**
 * Load image conversion options from project config.
 * Wrong values fail later in Sharp by design.
 * @returns {Promise<ResponsiveImageConfig>}
 */
export async function loadImageConversionConfig() {
    /** @type {Record<string, unknown>} */
    let userConfig = {};

    for (const configName of CONFIG_FILES) {
        const configPath = pathResolve(CWD, configName);
        if (!existsSync(configPath)) continue;
        const configModule = /** @type {{ default?: Record<string, unknown> }} */ (
            await import(`${pathToFileURL(configPath).href}?ts=${Date.now()}`)
        );
        userConfig = configModule.default ?? configModule;
        break;
    }

    const imageConfig = /** @type {{
        format?: keyof import('sharp').FormatEnum,
        quality?: number,
        sizes?: number[],
        injectIntrinsicSize?: boolean
    } | undefined} */ (userConfig.imageConversion);

    return {
        format: imageConfig?.format ?? DEFAULT_IMAGE_CONVERSION_CONFIG.format,
        quality: imageConfig?.quality,
        sizes: imageConfig?.sizes ?? [...DEFAULT_IMAGE_CONVERSION_CONFIG.sizes],
        injectIntrinsicSize: imageConfig?.injectIntrinsicSize
            ?? DEFAULT_IMAGE_CONVERSION_CONFIG.injectIntrinsicSize
    };
}

/**
 * Recursively walk a directory and return all files.
 * @param {string} dir
 * @returns {string[]}
 */
function walkDir(dir) {
    /** @type {string[]} */
    const out = [];
    if (!existsSync(dir)) return out;

    for (const entry of readdirSync(dir)) {
        const filePath = join(dir, entry);
        const stats = statSync(filePath);
        if (stats.isDirectory()) {
            out.push(...walkDir(filePath));
            continue;
        }
        out.push(filePath);
    }

    return out;
}

/**
 * Avoid upscaling while preserving explicit configured widths.
 * @param {number} sourceWidth
 * @param {number[]} configuredSizes
 * @returns {number[]}
 */
function buildVariantWidths(sourceWidth, configuredSizes) {
    /** @type {number[]} */
    const widths = [];
    /** @type {Set<number>} */
    const seen = new Set();

    for (const size of configuredSizes) {
        if (size > sourceWidth || seen.has(size)) continue;
        seen.add(size);
        widths.push(size);
    }

    if (!seen.has(sourceWidth)) {
        widths.push(sourceWidth);
    }

    widths.sort((a, b) => a - b);
    return widths;
}

/**
 * Return the build output URL for a source image.
 * @param {string} relativePath
 * @returns {string}
 */
function toBuildImageUrl(relativePath) {
    return `/images/${normalizeSlashes(relativePath)}`;
}

/**
 * Return the dev URL that Vite can serve straight from src/.
 * @param {string} sourcePath
 * @returns {string}
 */
function toDevImageUrl(sourcePath) {
    return `/@fs/${normalizeSlashes(sourcePath)}`;
}

/**
 * Build metadata needed to rewrite HTML and emit build assets.
 * Everything except SVG is treated as Sharp input.
 * @param {ResponsiveImageConfig} config
 * @returns {Promise<Map<string, ResponsiveImageEntry>>}
 */
export async function buildResponsiveImageManifest(config) {
    /** @type {Map<string, ResponsiveImageEntry>} */
    const manifest = new Map();

    for (const sourcePath of walkDir(SOURCE_IMAGES_DIR)) {
        const relativePath = normalizeSlashes(pathRelative(SOURCE_IMAGES_DIR, sourcePath));

        if (extname(sourcePath).toLowerCase() === '.svg') {
            manifest.set(sourcePath, {
                mode: 'passthrough',
                sourcePath,
                outputPath: relativePath,
                url: toBuildImageUrl(relativePath)
            });
            continue;
        }

        const metadata = await sharp(sourcePath).metadata();
        if (!metadata.width || !metadata.height) {
            throw new Error(`Unable to read image dimensions: ${sourcePath}`);
        }

        const relativeDir = dirname(relativePath);
        const targetDir = relativeDir === '.' ? '' : normalizeSlashes(relativeDir);
        const outputExtension = config.format.toLowerCase();
        /** @type {ResponsiveVariant[]} */
        const variants = [];

        for (const width of buildVariantWidths(metadata.width, config.sizes)) {
            const height = Math.max(1, Math.round((metadata.height * width) / metadata.width));
            const fileName = `${basename(relativePath, extname(relativePath))}-${width}.${outputExtension}`;
            const filePath = targetDir ? `${targetDir}/${fileName}` : fileName;
            variants.push({
                width,
                height,
                relativePath: filePath,
                url: toBuildImageUrl(filePath)
            });
        }

        const fallback = variants[variants.length - 1];
        if (!fallback) {
            throw new Error(`No responsive widths generated for: ${sourcePath}`);
        }

        manifest.set(sourcePath, {
            mode: 'responsive',
            sourcePath,
            outputPath: fallback.relativePath,
            url: fallback.url,
            sourceWidth: metadata.width,
            sourceHeight: metadata.height,
            variants
        });
    }

    return manifest;
}

/**
 * Split a URL into path and suffix segments.
 * @param {string} src
 * @returns {{ path: string, suffix: string }}
 */
function splitUrlSuffix(src) {
    const matchIndex = src.search(/[?#]/);
    if (matchIndex === -1) {
        return { path: src, suffix: '' };
    }

    return {
        path: src.slice(0, matchIndex),
        suffix: src.slice(matchIndex)
    };
}

/**
 * Resolve an authored img src into a file inside src/assets/images.
 * @param {string} src
 * @param {string} pageFileAbs
 * @returns {string}
 */
function resolveSourceImagePath(src, pageFileAbs) {
    if (!src) return '';
    if (/^(?:[a-z]+:)?\/\//i.test(src) || src.startsWith('data:') || src.startsWith('#')) {
        return '';
    }

    const { path } = splitUrlSuffix(src);
    if (!path) return '';

    let decodedPath = path;
    try {
        decodedPath = decodeURIComponent(path);
    } catch {
        decodedPath = path;
    }

    let resolvedPath = '';
    if (decodedPath.startsWith('/src/assets/images/')) {
        resolvedPath = pathResolve(CWD, `.${decodedPath}`);
    } else if (decodedPath.startsWith('src/assets/images/')) {
        resolvedPath = pathResolve(CWD, decodedPath);
    } else if (decodedPath.startsWith('/assets/images/')) {
        resolvedPath = pathResolve(CWD, `src${decodedPath}`);
    } else if (decodedPath.startsWith('assets/images/')) {
        resolvedPath = pathResolve(CWD, 'src', decodedPath);
    } else if (!decodedPath.startsWith('/')) {
        resolvedPath = pathResolve(dirname(pageFileAbs), decodedPath);
    }

    if (!resolvedPath || !existsSync(resolvedPath) || !isSourceImagePath(resolvedPath)) {
        return '';
    }

    return resolvedPath;
}

/**
 * Parse an img tag into ordered attributes.
 * @param {string} tag
 * @returns {ParsedImgAttribute[]}
 */
function parseImgAttributes(tag) {
    /** @type {ParsedImgAttribute[]} */
    const attrs = [];
    const inner = tag.replace(/^<img\b/i, '').replace(/\/?>$/, '');

    let match;
    IMG_ATTR_RX.lastIndex = 0;
    while ((match = IMG_ATTR_RX.exec(inner))) {
        attrs.push({
            name: match[1],
            value: match[2] ?? match[3] ?? match[4] ?? null,
            quote: match[2] !== undefined || match[4] !== undefined ? '"' : "'"
        });
    }

    return attrs;
}

/**
 * Find an attribute case-insensitively.
 * @param {ParsedImgAttribute[]} attrs
 * @param {string} name
 * @returns {ParsedImgAttribute | undefined}
 */
function findAttr(attrs, name) {
    const lowerName = name.toLowerCase();
    for (const attr of attrs) {
        if (attr.name.toLowerCase() === lowerName) return attr;
    }
}

/**
 * Upsert an attribute while keeping original order stable.
 * @param {ParsedImgAttribute[]} attrs
 * @param {string} name
 * @param {string} value
 * @returns {void}
 */
function upsertAttr(attrs, name, value) {
    const attr = findAttr(attrs, name);
    if (attr) {
        attr.value = value;
        return;
    }

    attrs.push({ name, value, quote: '"' });
}

/**
 * Serialize ordered attributes back into an img tag.
 * @param {ParsedImgAttribute[]} attrs
 * @param {boolean} selfClosing
 * @returns {string}
 */
function serializeImgTag(attrs, selfClosing) {
    /** @type {string[]} */
    const parts = [];

    for (const attr of attrs) {
        if (attr.value === null) {
            parts.push(attr.name);
            continue;
        }

        const quote = attr.quote || '"';
        const escapedValue = quote === '"'
            ? attr.value.replaceAll('"', '&quot;')
            : attr.value.replaceAll("'", '&#39;');
        parts.push(`${attr.name}=${quote}${escapedValue}${quote}`);
    }

    return selfClosing
        ? `<img ${parts.join(' ')} />`
        : `<img ${parts.join(' ')}>`;
}

/**
 * Rewrite local source images for dev or build output.
 * @param {string} html
 * @param {string} pageFileAbs
 * @param {{
 *   responsiveImages?: boolean,
 *   imageManifest?: Map<string, ResponsiveImageEntry>,
 *   imageConfig?: ResponsiveImageConfig
 * }} [options]
 * @returns {string}
 */
export function transformHtmlImages(html, pageFileAbs, options = {}) {
    const responsiveImages = Boolean(options.responsiveImages);
    const imageManifest = options.imageManifest;
    const injectIntrinsicSize = options.imageConfig?.injectIntrinsicSize !== false;

    return html.replace(IMG_TAG_RX, (tag) => {
        const attrs = parseImgAttributes(tag);
        const srcAttr = findAttr(attrs, 'src');
        if (!srcAttr || srcAttr.value === null) return tag;

        const sourcePath = resolveSourceImagePath(srcAttr.value, pageFileAbs);
        if (!sourcePath) return tag;

        if (!responsiveImages || !imageManifest) {
            upsertAttr(attrs, 'src', `${toDevImageUrl(sourcePath)}${splitUrlSuffix(srcAttr.value).suffix}`);
            return serializeImgTag(attrs, tag.endsWith('/>'));
        }

        const entry = imageManifest.get(sourcePath);
        if (!entry) return tag;

        if (entry.mode === 'passthrough') {
            upsertAttr(attrs, 'src', entry.url);
            return serializeImgTag(attrs, tag.endsWith('/>'));
        }

        upsertAttr(attrs, 'src', entry.url);
        upsertAttr(
            attrs,
            'srcset',
            entry.variants.map((variant) => `${variant.url} ${variant.width}w`).join(', ')
        );

        if (injectIntrinsicSize && !findAttr(attrs, 'width')) {
            upsertAttr(attrs, 'width', String(entry.sourceWidth));
        }
        if (injectIntrinsicSize && !findAttr(attrs, 'height')) {
            upsertAttr(attrs, 'height', String(entry.sourceHeight));
        }

        return serializeImgTag(attrs, tag.endsWith('/>'));
    });
}

/**
 * Emit responsive images into build/images.
 * @param {Map<string, ResponsiveImageEntry>} manifest
 * @param {string} outDir
 * @param {ResponsiveImageConfig} config
 * @returns {Promise<void>}
 */
export async function writeResponsiveImages(manifest, outDir, config) {
    rmSync(outDir, { recursive: true, force: true });
    if (manifest.size === 0) return;

    for (const entry of manifest.values()) {
        const relativeSourcePath = normalizeSlashes(pathRelative(CWD, entry.sourcePath));

        if (entry.mode === 'passthrough') {
            const targetPath = pathResolve(outDir, entry.outputPath);
            mkdirSync(dirname(targetPath), { recursive: true });
            copyFileSync(entry.sourcePath, targetPath);
            console.log(`[images] copied ${relativeSourcePath}`);
            continue;
        }

        for (const variant of entry.variants) {
            const variantPath = pathResolve(outDir, variant.relativePath);
            mkdirSync(dirname(variantPath), { recursive: true });
            const pipeline = sharp(entry.sourcePath)
                .rotate()
                .resize({ width: variant.width, withoutEnlargement: true });

            if (config.quality === undefined) {
                await pipeline
                    .toFormat(config.format)
                    .toFile(variantPath);
                continue;
            }

            await pipeline
                .toFormat(config.format, { quality: config.quality })
                .toFile(variantPath);
        }

        console.log(`[images] converted ${relativeSourcePath}`);
    }
}
