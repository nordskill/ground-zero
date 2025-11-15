import { defineConfig } from 'vite';
import { resolve as pathResolve, isAbsolute as pathIsAbsolute } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import { compileAll, compilePage, buildDependencyGraph, getImpactedPages } from './scripts/compile-ejs.js';
import browserSync from 'vite-plugin-browser-sync';

// Resolve everything relative to the caller's project root (where CLI is run),
// not the package install directory. This makes the packaged config reusable.
const PROJECT_ROOT = process.cwd();

function ejsLiveReload() {
    let graph = null;
    let pending = new Set();
    let timer = null;

    function toAbs(p) {
        return pathIsAbsolute(p) ? p : pathResolve(PROJECT_ROOT, p);
    }

    async function flush(server) {
        const changed = Array.from(pending);
        pending.clear();
        clearTimeout(timer);
        timer = null;

        // Recompute graph to pick up any structure changes
        graph = await buildDependencyGraph();

        const impacted = getImpactedPages(changed, graph);
        if (impacted.size === 0) {
            // If no mapping found (e.g., first run or non-mapped change), rebuild all
            await compileAll();
        } else {
            for (const page of impacted) {
                await compilePage(page);
            }
        }
        server.ws.send({ type: 'full-reload' });
    }

    function schedule(server, file) {
        pending.add(file);
        if (!timer) timer = setTimeout(() => flush(server), 25);
    }

    return {
        name: 'ejs-live-reload',
        apply: 'serve',
        async configureServer(server) {
            graph = await buildDependencyGraph();
            const pagesDir = pathResolve(PROJECT_ROOT, 'src/pages');
            const partialsDir = pathResolve(PROJECT_ROOT, 'src/partials');
            const watchGlobs = [
                `${pagesDir}/**/*.ejs`,
                `${partialsDir}/**/*.ejs`,
                pagesDir,
                partialsDir
            ];
            server.watcher.add(watchGlobs);
            console.log('[ejs-live-reload] watching:', watchGlobs);

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

function findHtmlEntries(rootDir) {
    const entries = [];
    const stack = [rootDir];
    while (stack.length) {
        const dir = stack.pop();
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
    // Discover all compiled HTML pages as build inputs (multi-page)
    const htmlInputs = findHtmlEntries(pathResolve(PROJECT_ROOT, 'dev-html'));

    return {
        // Serve compiled HTML from dev-html/ under the caller's project
        root: pathResolve(PROJECT_ROOT, 'dev-html'),
        server: {
            fs: {
                // Allow importing from the project root so /src/* works during dev
                allow: [pathResolve(PROJECT_ROOT, '.')]
            }
        },
        build: {
            // Emit build/ under the caller's project
            outDir: pathResolve(PROJECT_ROOT, 'build'),
            emptyOutDir: true,
            cssMinify: false,
            rollupOptions: {
                input: htmlInputs.length ? htmlInputs : undefined
            }
        },
        plugins: [
            ejsLiveReload(),
            browserSync()
        ]
    };
});


