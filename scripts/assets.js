import {
    copyFileSync,
    createReadStream,
    existsSync,
    mkdirSync,
    readdirSync,
    statSync
} from 'node:fs';
import {
    dirname,
    extname,
    join,
    relative as pathRelative,
    resolve as pathResolve,
    sep
} from 'node:path';

const CWD = process.cwd();
const SOURCE_ASSETS_DIR = pathResolve(CWD, 'src/assets');
const VITE_MANAGED_ASSET_DIRS = new Set(['css', 'js']);

/**
 * Normalize Windows path separators for URL usage.
 * @param {string} value - File path or URL fragment.
 * @returns {string} Normalized string with forward slashes.
 */
function normalizeSlashes(value) {
    return value.replaceAll('\\', '/');
}

/**
 * Split a URL into its path and trailing query/hash suffix.
 * @param {string} src - Original request URL.
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
 * Guard against `..` segments escaping the source asset root.
 * @param {string} assetPath - Relative asset path.
 * @returns {boolean} `true` when traversal is present.
 */
function hasParentTraversal(assetPath) {
    return assetPath.split('/').some((segment) => segment === '..');
}

/**
 * Resolve a public `/assets/**` URL back to a file inside `src/assets`.
 * @param {string} value - Request URL or authored asset URL.
 * @returns {{ relativePath: string, sourcePath: string, publicUrl: string } | null}
 * Source asset resolution data, or `null` when the URL is outside `/assets/**`.
 */
export function resolveSourceAssetRequest(value) {
    const input = String(value ?? '').trim();
    if (!input) return null;
    if (/^(?:[a-z]+:)?\/\//i.test(input) || input.startsWith('data:') || input.startsWith('#')) {
        return null;
    }

    const { path, suffix } = splitUrlSuffix(input);
    const normalized = normalizeSlashes(path);
    const relativePath = normalized.startsWith('/assets/')
        ? normalized.slice('/assets/'.length)
        : normalized.startsWith('assets/')
            ? normalized.slice('assets/'.length)
            : '';

    if (!relativePath || hasParentTraversal(relativePath)) {
        return null;
    }

    const sourcePath = pathResolve(SOURCE_ASSETS_DIR, relativePath);
    const sourcePrefix = `${SOURCE_ASSETS_DIR}${sep}`;
    if (sourcePath !== SOURCE_ASSETS_DIR && !sourcePath.startsWith(sourcePrefix)) {
        return null;
    }

    return {
        relativePath,
        sourcePath,
        publicUrl: `/assets/${relativePath}${suffix}`
    };
}

/**
 * Copy static source assets into the production `build/assets` tree.
 * Vite-managed `css` and `js` directories are excluded because Vite emits them.
 * Additional top-level directories can be skipped when another build step owns them.
 * @param {string} outDir - Absolute destination directory, typically `build/assets`.
 * @param {{ skipTopLevelDirs?: string[] }} [options] - Optional exclusion settings.
 * @returns {void}
 */
export function copySourceAssetsToBuild(outDir, options = {}) {
    if (!existsSync(SOURCE_ASSETS_DIR)) return;

    const skipTopLevelDirs = new Set(options.skipTopLevelDirs ?? []);

    /** @type {string[]} */
    const stack = [SOURCE_ASSETS_DIR];
    while (stack.length) {
        const currentDir = stack.pop();
        if (!currentDir) continue;

        for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
            if (entry.name.startsWith('.')) {
                continue;
            }

            const entryPath = join(currentDir, entry.name);
            const relativePath = normalizeSlashes(pathRelative(SOURCE_ASSETS_DIR, entryPath));
            const [topLevel] = relativePath.split('/');

            if (entry.isDirectory()) {
                if (currentDir === SOURCE_ASSETS_DIR && (VITE_MANAGED_ASSET_DIRS.has(topLevel) || skipTopLevelDirs.has(topLevel))) {
                    continue;
                }
                stack.push(entryPath);
                continue;
            }

            if (VITE_MANAGED_ASSET_DIRS.has(topLevel) || skipTopLevelDirs.has(topLevel)) {
                continue;
            }

            const outPath = pathResolve(outDir, relativePath);
            mkdirSync(dirname(outPath), { recursive: true });
            copyFileSync(entryPath, outPath);
        }
    }
}

/**
 * Resolve the HTTP content type for a static asset file.
 * @param {string} filePath - Absolute file path.
 * @returns {string} Content-Type header value.
 */
export function getAssetContentType(filePath) {
    switch (extname(filePath).toLowerCase()) {
        case '.avif': return 'image/avif';
        case '.css': return 'text/css; charset=utf-8';
        case '.gif': return 'image/gif';
        case '.html': return 'text/html; charset=utf-8';
        case '.ico': return 'image/x-icon';
        case '.jpeg':
        case '.jpg': return 'image/jpeg';
        case '.js': return 'text/javascript; charset=utf-8';
        case '.json': return 'application/json; charset=utf-8';
        case '.m4a': return 'audio/mp4';
        case '.mp3': return 'audio/mpeg';
        case '.mp4': return 'video/mp4';
        case '.ogg': return 'audio/ogg';
        case '.ogv': return 'video/ogg';
        case '.pdf': return 'application/pdf';
        case '.png': return 'image/png';
        case '.svg': return 'image/svg+xml';
        case '.txt': return 'text/plain; charset=utf-8';
        case '.wav': return 'audio/wav';
        case '.webm': return 'video/webm';
        case '.webp': return 'image/webp';
        case '.woff': return 'font/woff';
        case '.woff2': return 'font/woff2';
        case '.ttf': return 'font/ttf';
        case '.otf': return 'font/otf';
        case '.xml': return 'application/xml; charset=utf-8';
        default: return 'application/octet-stream';
    }
}

/**
 * Stream a source asset file into an HTTP response.
 * @param {import('node:http').ServerResponse} res - Node HTTP response.
 * @param {string} filePath - Absolute file path to stream.
 * @returns {void}
 */
export function streamSourceAsset(res, filePath) {
    res.statusCode = 200;
    res.setHeader('Content-Type', getAssetContentType(filePath));
    createReadStream(filePath).pipe(res);
}

/**
 * Check whether a request targets the `/assets/**` source asset contract.
 * @param {string} requestPath - Request pathname or URL.
 * @returns {boolean} `true` when the request points at a supported asset URL.
 */
export function isSourceAssetUrl(requestPath) {
    return resolveSourceAssetRequest(requestPath) !== null;
}

/**
 * Check whether a path exists and points to a regular file.
 * @param {string} filePath - Absolute file path.
 * @returns {boolean} `true` when the file exists.
 */
export function isExistingFile(filePath) {
    return existsSync(filePath) && statSync(filePath).isFile();
}
