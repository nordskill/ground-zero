import { defineConfig } from 'vite';
import { resolve as pathResolve, isAbsolute as pathIsAbsolute, extname } from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { compileAll, compilePage, buildDependencyGraph, getImpactedPages } from './scripts/compile-ejs.js';
import {
    isExistingFile,
    isSourceAssetUrl,
    resolveSourceAssetRequest,
    streamSourceAsset
} from './scripts/assets.js';
import { generateSvgSprite } from './scripts/svg-sprite.js';
import browserSync from 'vite-plugin-browser-sync';

const PROJECT_ROOT = process.cwd();
const HTML_ROOT = process.env.GZERO_HTML_ROOT
    ? pathResolve(PROJECT_ROOT, process.env.GZERO_HTML_ROOT)
    : pathResolve(PROJECT_ROOT, 'dev-html');

/**
 * Return the output pattern for Vite-emitted bundles and imported assets.
 * @param {import('rollup').PreRenderedAsset} assetInfo - Rollup asset metadata.
 * @returns {string} Rollup output pattern.
 */
function getBundledAssetFileName(assetInfo) {
    const fileName = assetInfo.names?.[0] ?? assetInfo.name ?? '';
    const extension = extname(fileName).toLowerCase();

    if (extension === '.css') return 'assets/css/[name]-[hash][extname]';
    if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif'].includes(extension)) {
        return 'assets/images/[name]-[hash][extname]';
    }
    if (['.webm', '.mp4', '.ogv', '.mp3', '.wav', '.ogg', '.m4a'].includes(extension)) {
        return 'assets/media/[name]-[hash][extname]';
    }
    if (['.woff', '.woff2', '.ttf', '.otf'].includes(extension)) {
        return 'assets/fonts/[name]-[hash][extname]';
    }

    return 'assets/misc/[name]-[hash][extname]';
}

/**
 * Generate the SVG sprite partial before dev or build work begins.
 * @returns {import('vite').Plugin} Vite plugin definition.
 */
function svgSpritePlugin() {
    const iconsDir = pathResolve(PROJECT_ROOT, 'src/assets/icons');
    const spritePartial = pathResolve(PROJECT_ROOT, 'src/partials/svg-sprite.ejs');

    return {
        name: 'svg-sprite',
        async buildStart() {
            try {
                await generateSvgSprite(iconsDir, spritePartial);
                console.log('[svg-sprite] generated (build)');
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                console.error('[svg-sprite] error:', message);
            }
        }
    };
}

/**
 * Recompile affected EJS pages and trigger a full browser reload.
 * @returns {import('vite').Plugin} Vite dev plugin.
 */
function ejsLiveReload() {
    /** @type {{
     *   pages: Set<string>,
     *   partials: Set<string>,
     *   includes: Map<string, Set<string>>,
     *   dependents: Map<string, Set<string>>
     * } | null} */
    let graph = null;
    /** @type {Set<string>} */
    let pending = new Set();
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;

    /**
     * Convert a watcher path to an absolute filesystem path.
     * @param {string} p - Relative or absolute path.
     * @returns {string} Absolute path.
     */
    function toAbs(p) {
        return pathIsAbsolute(p) ? p : pathResolve(PROJECT_ROOT, p);
    }

    /**
     * Rebuild affected pages and force a browser reload.
     * @param {import('vite').ViteDevServer} server - Active Vite dev server.
     * @returns {Promise<void>}
     */
    async function flush(server) {
        const changed = Array.from(pending);
        pending.clear();
        clearTimeout(timer ?? undefined);
        timer = null;

        graph = await buildDependencyGraph();

        const impacted = getImpactedPages(changed, graph);
        if (impacted.size === 0) {
            await compileAll();
        } else {
            for (const page of impacted) {
                await compilePage(page);
            }
        }
        server.ws.send({ type: 'full-reload' });
    }

    /**
     * Batch multiple file changes into one rebuild.
     * @param {import('vite').ViteDevServer} server - Active Vite dev server.
     * @param {string} file - Changed file path.
     * @returns {void}
     */
    function schedule(server, file) {
        pending.add(file);
        if (!timer) timer = setTimeout(() => flush(server), 25);
    }

    return {
        name: 'ejs-live-reload',
        apply: 'serve',
        /**
         * Register EJS watchers and rebuild callbacks.
         * @param {import('vite').ViteDevServer} server - Active Vite dev server.
         * @returns {Promise<void>}
         */
        async configureServer(server) {
            graph = await buildDependencyGraph();
            const srcDir = pathResolve(PROJECT_ROOT, 'src');
            const watchGlobs = [
                `${srcDir}/**/*.ejs`,
                srcDir
            ];
            server.watcher.add(watchGlobs);
            console.log('[ejs-live-reload] watching:', watchGlobs);

            /**
             * Build a watcher callback for a specific event type.
             * @param {'change' | 'add' | 'unlink'} type - Watcher event name.
             * @returns {(file: string) => void} Chokidar callback.
             */
            const mkHandler = (type) => (file) => {
                if (!file.endsWith('.ejs')) return;
                const abs = toAbs(file);
                console.log(`[ejs-live-reload] ${type}:`, abs);
                schedule(server, abs);
            };

            server.watcher.on('change', mkHandler('change'));
            server.watcher.on('add', mkHandler('add'));
            server.watcher.on('unlink', mkHandler('unlink'));
        }
    };
}

/**
 * Serve source assets directly from `src/assets` during development.
 * @returns {import('vite').Plugin} Vite dev plugin.
 */
function sourceAssetsPlugin() {
    const srcAssetsDir = pathResolve(PROJECT_ROOT, 'src/assets');

    return {
        name: 'source-assets',
        apply: 'serve',
        /**
         * Register asset watchers and the `/assets/**` middleware.
         * @param {import('vite').ViteDevServer} server - Active Vite dev server.
         * @returns {void}
         */
        configureServer(server) {
            if (existsSync(srcAssetsDir)) {
                server.watcher.add(srcAssetsDir);
            }

            /**
             * Build a watcher callback for asset changes.
             * @param {'change' | 'add' | 'unlink'} type - Watcher event name.
             * @returns {(file: string) => void} Chokidar callback.
             */
            const reloadOnAssetChange = (type) => (file) => {
                if (!file.startsWith(srcAssetsDir)) return;
                console.log(`[source-assets] ${type}:`, file);
                server.ws.send({ type: 'full-reload' });
            };

            server.watcher.on('add', reloadOnAssetChange('add'));
            server.watcher.on('change', reloadOnAssetChange('change'));
            server.watcher.on('unlink', reloadOnAssetChange('unlink'));

            /**
             * Serve matching `/assets/**` requests from `src/assets`.
             * @param {import('node:http').IncomingMessage} req - Incoming HTTP request.
             * @param {import('node:http').ServerResponse} res - HTTP response.
             * @param {() => void} next - Pass-through callback.
             * @returns {void}
             */
            server.middlewares.use((req, res, next) => {
                const requestUrl = req.url ?? '';

                if (!isSourceAssetUrl(requestUrl)) {
                    next();
                    return;
                }

                const resolved = resolveSourceAssetRequest(requestUrl);
                if (!resolved) {
                    next();
                    return;
                }

                if (!isExistingFile(resolved.sourcePath)) {
                    console.warn(`[source-assets] 404 ${requestUrl} -> ${resolved.sourcePath}`);
                    res.statusCode = 404;
                    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                    res.end(`Ground Zero asset not found: ${requestUrl}`);
                    return;
                }

                streamSourceAsset(res, resolved.sourcePath);
            });
        }
    };
}

/**
 * Discover compiled HTML files under the active HTML root.
 * @param {string} rootDir - Root directory to scan.
 * @returns {string[]} Absolute HTML entry paths.
 */
function findHtmlEntries(rootDir) {
    /** @type {string[]} */
    const entries = [];
    /** @type {string[]} */
    const stack = [rootDir];
    while (stack.length) {
        const dir = stack.pop();
        if (!dir) continue;
        for (const name of readdirSync(dir)) {
            const p = pathResolve(dir, name);
            const s = statSync(p);
            if (s.isDirectory()) {
                stack.push(p);
            } else if (name.endsWith('.html')) {
                entries.push(p);
            }
        }
    }
    return entries;
}

export default defineConfig(() => {
    const htmlInputs = findHtmlEntries(HTML_ROOT);

    return {
        root: HTML_ROOT,
        publicDir: pathResolve(PROJECT_ROOT, 'public'),
        server: {
            fs: {
                allow: [pathResolve(PROJECT_ROOT, '.')]
            }
        },
        build: {
            outDir: pathResolve(PROJECT_ROOT, 'build'),
            emptyOutDir: true,
            cssMinify: false,
            rollupOptions: {
                input: htmlInputs.length ? htmlInputs : undefined,
                output: {
                    entryFileNames: 'assets/js/[name]-[hash].js',
                    chunkFileNames: 'assets/js/[name]-[hash].js',
                    assetFileNames: getBundledAssetFileName
                }
            }
        },
        plugins: [
            svgSpritePlugin(),
            ejsLiveReload(),
            sourceAssetsPlugin(),
            browserSync()
        ]
    };
});
