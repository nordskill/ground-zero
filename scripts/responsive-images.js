import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
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
import sharp from 'sharp';
import { stripBasePath, withBase } from './base-path.js';
import { loadProjectConfig } from './project-config.js';

const CWD = process.cwd();
const SOURCE_IMAGES_DIR = pathResolve(CWD, 'src/assets/images');
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
 * Check that a file path lives inside `src/assets/images`.
 * @param {string} filePath - Absolute file path.
 * @returns {boolean} `true` when the file is a source image.
 */
function isSourceImagePath(filePath) {
    return filePath === SOURCE_IMAGES_DIR || filePath.startsWith(`${SOURCE_IMAGES_DIR}${sep}`);
}

/**
 * Normalize Windows separators for URLs.
 * @param {string} value - File path or URL fragment.
 * @returns {string} URL-safe path.
 */
function normalizeSlashes(value) {
    return value.replaceAll('\\', '/');
}

/**
 * Load image conversion settings from project config.
 * @returns {Promise<ResponsiveImageConfig>} Effective responsive image config.
 */
export async function loadImageConversionConfig() {
    const userConfig = await loadProjectConfig();

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
 * @param {string} dir - Directory to scan.
 * @returns {string[]} Absolute file paths.
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
 * Build responsive widths without upscaling.
 * @param {number} sourceWidth - Original image width.
 * @param {number[]} configuredSizes - Configured target widths.
 * @returns {number[]} Output widths.
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
 * Return the production URL for a generated image asset.
 * @param {string} relativePath - Path relative to `src/assets/images`.
 * @param {string} basePath - Normalized deploy base path.
 * @returns {string} Public build URL.
 */
function toBuildImageUrl(relativePath, basePath) {
    return withBase(`/assets/images/${normalizeSlashes(relativePath)}`, basePath);
}

/**
 * Build metadata used to rewrite HTML and emit responsive images.
 * @param {ResponsiveImageConfig} config - Effective image conversion config.
 * @param {string} [basePath='/'] - Normalized deploy base path.
 * @returns {Promise<Map<string, ResponsiveImageEntry>>} Source image manifest.
 */
export async function buildResponsiveImageManifest(config, basePath = '/') {
    /** @type {Map<string, ResponsiveImageEntry>} */
    const manifest = new Map();
    if (!existsSync(SOURCE_IMAGES_DIR)) return manifest;

    for (const sourcePath of walkDir(SOURCE_IMAGES_DIR)) {
        const relativePath = normalizeSlashes(pathRelative(SOURCE_IMAGES_DIR, sourcePath));

        if (extname(sourcePath).toLowerCase() === '.svg') {
            manifest.set(sourcePath, {
                mode: 'passthrough',
                sourcePath,
                outputPath: relativePath,
                url: toBuildImageUrl(relativePath, basePath)
            });
            continue;
        }

        let metadata;
        try {
            metadata = await sharp(sourcePath).metadata();
        } catch {
            continue;
        }

        if (!metadata.width || !metadata.height) {
            continue;
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
                url: toBuildImageUrl(filePath, basePath)
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
 * @param {string} src - Original URL.
 * @returns {{ path: string, suffix: string }} Parsed URL parts.
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
 * Resolve an authored `<img src>` into a file inside `src/assets/images`.
 * Only the canonical `/assets/images/**` contract is supported.
 * @param {string} src - Authored image source URL.
 * @param {string} basePath - Normalized deploy base path.
 * @returns {string} Absolute source image path, or an empty string when unsupported.
 */
function resolveSourceImagePath(src, basePath) {
    if (!src) return '';
    if (/^(?:[a-z]+:)?\/\//i.test(src) || src.startsWith('data:') || src.startsWith('#')) {
        return '';
    }

    const normalizedInputPath = normalizeSlashes(splitUrlSuffix(src).path);
    const strippedSrc = stripBasePath(src, basePath);
    const prefersStrippedCandidate = basePath !== '/' && normalizedInputPath.startsWith(withBase('/assets/images/', basePath));
    const candidates = prefersStrippedCandidate
        ? [strippedSrc, src]
        : strippedSrc === src ? [src] : [src, strippedSrc];

    for (const candidate of candidates) {
        const relativePath = resolveImageCandidate(candidate);
        if (!relativePath) continue;

        const resolvedPath = pathResolve(SOURCE_IMAGES_DIR, relativePath);
        if (!existsSync(resolvedPath) || !isSourceImagePath(resolvedPath)) {
            continue;
        }

        return resolvedPath;
    }

    return '';

    /**
     * Parse one candidate image URL into the canonical `/assets/images/**` contract.
     * @param {string} candidate - Raw or base-stripped image URL.
     * @returns {string} Relative image path, or an empty string when unsupported.
     */
    function resolveImageCandidate(candidate) {
        const { path } = splitUrlSuffix(candidate);
        if (!path) return '';

        let decodedPath = path;
        try {
            decodedPath = decodeURIComponent(path);
        } catch {
            decodedPath = path;
        }

        return decodedPath.startsWith('/assets/images/')
            ? decodedPath.slice('/assets/images/'.length)
            : decodedPath.startsWith('assets/images/')
                ? decodedPath.slice('assets/images/'.length)
                : '';
    }
}

/**
 * Parse an `<img>` tag into ordered attributes.
 * @param {string} tag - Raw HTML tag.
 * @returns {ParsedImgAttribute[]} Parsed attributes.
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
 * @param {ParsedImgAttribute[]} attrs - Parsed attributes.
 * @param {string} name - Attribute name.
 * @returns {ParsedImgAttribute | undefined} Matching attribute.
 */
function findAttr(attrs, name) {
    const lowerName = name.toLowerCase();
    for (const attr of attrs) {
        if (attr.name.toLowerCase() === lowerName) return attr;
    }
}

/**
 * Insert or update an attribute while preserving order.
 * @param {ParsedImgAttribute[]} attrs - Parsed attributes.
 * @param {string} name - Attribute name.
 * @param {string} value - Attribute value.
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
 * Serialize parsed attributes back to an `<img>` tag.
 * @param {ParsedImgAttribute[]} attrs - Parsed attributes.
 * @param {boolean} selfClosing - Whether the original tag was self-closing.
 * @returns {string} Serialized tag.
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
 * Rewrite image tags for production responsive output.
 * @param {string} html - Rendered HTML.
 * @param {{
 *   responsiveImages?: boolean,
 *   imageManifest?: Map<string, ResponsiveImageEntry>,
 *   imageConfig?: ResponsiveImageConfig,
 *   basePath?: string
 * }} [options] - Build-time image options.
 * @returns {string} HTML with responsive image attributes applied.
 */
export function transformHtmlImages(html, options = {}) {
    const responsiveImages = Boolean(options.responsiveImages);
    const imageManifest = options.imageManifest;
    const injectIntrinsicSize = options.imageConfig?.injectIntrinsicSize !== false;
    const basePath = options.basePath ?? '/';

    if (!responsiveImages || !imageManifest) {
        return html;
    }

    return html.replace(IMG_TAG_RX, (tag) => {
        const attrs = parseImgAttributes(tag);
        const srcAttr = findAttr(attrs, 'src');
        if (!srcAttr || srcAttr.value === null) return tag;

        const sourcePath = resolveSourceImagePath(srcAttr.value, basePath);
        if (!sourcePath) return tag;

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
 * Emit responsive image files into `build/assets/images`.
 * @param {Map<string, ResponsiveImageEntry>} manifest - Source image manifest.
 * @param {string} outDir - Absolute output directory.
 * @param {ResponsiveImageConfig} config - Effective image conversion config.
 * @returns {Promise<void>}
 */
export async function writeResponsiveImages(manifest, outDir, config) {
    if (manifest.size === 0) return;
    mkdirSync(outDir, { recursive: true });

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
