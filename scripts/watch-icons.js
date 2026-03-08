/**
 * Standalone watcher for the icons folder using Node's native fs.watch API.
 * Regenerates the SVG sprite on any change (add/modify/delete) in the icons directory.
 * If the icons directory does not exist yet, follows the src -> assets -> icons
 * path and starts the icons watcher as soon as the folder appears.
 * 
 * Usage: node scripts/watch-icons.js
 * 
 * This script is designed to run alongside Vite dev server and uses native OS
 * filesystem notifications for maximum V8 performance.
 */
import { watch, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { generateSvgSprite } from './svg-sprite.js';

const CWD = process.cwd();
const SRC_DIR = join(CWD, 'src');
const ASSETS_DIR = join(CWD, 'src/assets');
const ICONS_DIR = join(CWD, 'src/assets/icons');
const SPRITE_PARTIAL = join(CWD, 'src/partials/svg-sprite.ejs');
const WATCH_STEPS = [SRC_DIR, ASSETS_DIR, ICONS_DIR];

// Debounce timer to batch rapid changes (e.g. bulk delete/paste)
/** @type {ReturnType<typeof setTimeout> | null} */
let debounceTimer = null;
const DEBOUNCE_MS = 20; // Must be < EJS debounce (25ms) to avoid race conditions
const POLL_MS = 250;

/** @type {import('node:fs').FSWatcher | null} */
let pathWatcher = null;
/** @type {import('node:fs').FSWatcher | null} */
let iconsWatcher = null;
let pathWatchDir = '';
let pathWatchEntry = '';
let hasIconsDir = existsSync(ICONS_DIR);
let usePolling = false;
/** @type {ReturnType<typeof setInterval> | null} */
let pollTimer = null;
let lastIconsFingerprint = getIconsFingerprint();

/**
 * Find the next path step that should be monitored to reach src/assets/icons.
 * @returns {{ dir: string, entry: string }}
 */
function getPathWatchTarget() {
    for (const stepPath of WATCH_STEPS) {
        if (!existsSync(stepPath)) {
            return {
                dir: dirname(stepPath),
                entry: basename(stepPath)
            };
        }
    }
    return {
        dir: dirname(ICONS_DIR),
        entry: basename(ICONS_DIR)
    };
}

async function rebuild() {
    try {
        await generateSvgSprite(ICONS_DIR, SPRITE_PARTIAL);
        console.log('[watch-icons] sprite regenerated');
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[watch-icons] error:', message);
    }
}

/**
 * Build a stable fingerprint of current SVG files for polling fallback.
 * @returns {string}
 */
function getIconsFingerprint() {
    if (!existsSync(ICONS_DIR)) return '';
    /** @type {string[]} */
    const parts = [];
    for (const entry of readdirSync(ICONS_DIR)) {
        if (!entry.endsWith('.svg')) continue;
        const filePath = join(ICONS_DIR, entry);
        const stat = statSync(filePath, { throwIfNoEntry: false });
        if (!stat || !stat.isFile()) continue;
        parts.push(`${entry}:${stat.size}:${stat.mtimeMs}`);
    }
    parts.sort();
    return parts.join('|');
}

function scheduleRebuild() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void rebuild();
    }, DEBOUNCE_MS);
}

/**
 * Ensure the path watcher follows the nearest existing parent directory.
 * @returns {void}
 */
function syncPathWatcher() {
    if (usePolling) return;
    const target = getPathWatchTarget();
    if (pathWatcher && pathWatchDir === target.dir && pathWatchEntry === target.entry) return;
    if (pathWatcher) {
        pathWatcher.close();
        pathWatcher = null;
    }
    pathWatchDir = target.dir;
    pathWatchEntry = target.entry;
    try {
        pathWatcher = watch(pathWatchDir, (eventType, filename) => {
            if (filename && String(filename) !== pathWatchEntry) return;
            console.log(`[watch-icons] ${eventType}: ${pathWatchEntry}`);
            syncIconsWatcher();
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[watch-icons] path watcher error:', message);
        startPolling();
        return;
    }
    pathWatcher.on('error', (err) => {
        console.error('[watch-icons] path watcher error:', err.message);
        startPolling();
    });
    console.log(`[watch-icons] monitoring: ${pathWatchDir}`);
}

/**
 * Start watching the icons directory itself once it exists.
 * @returns {void}
 */
function startIconsWatcher() {
    if (usePolling || iconsWatcher || !existsSync(ICONS_DIR)) return;
    try {
        iconsWatcher = watch(ICONS_DIR, { recursive: true }, (eventType, filename) => {
            if (!filename || !String(filename).endsWith('.svg')) return;
            console.log(`[watch-icons] ${eventType}: ${filename}`);
            scheduleRebuild();
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[watch-icons] icons watcher error:', message);
        startPolling();
        return;
    }
    iconsWatcher.on('error', (err) => {
        console.error('[watch-icons] icons watcher error:', err.message);
        stopIconsWatcher();
        startPolling();
    });
    console.log(`[watch-icons] watching icons: ${ICONS_DIR}`);
}

/**
 * Stop watching the icons directory after it disappears.
 * @returns {void}
 */
function stopIconsWatcher() {
    if (!iconsWatcher) return;
    iconsWatcher.close();
    iconsWatcher = null;
}

/**
 * Fall back to polling when native filesystem watchers are unavailable.
 * @returns {void}
 */
function startPolling() {
    if (usePolling) return;
    usePolling = true;
    if (pathWatcher) {
        pathWatcher.close();
        pathWatcher = null;
    }
    stopIconsWatcher();
    pollTimer = setInterval(() => {
        syncIconsWatcher(false);
        const nextFingerprint = getIconsFingerprint();
        if (nextFingerprint === lastIconsFingerprint) return;
        lastIconsFingerprint = nextFingerprint;
        if (hasIconsDir) scheduleRebuild();
    }, POLL_MS);
    console.log(`[watch-icons] polling fallback enabled (${POLL_MS}ms)`);
}

/**
 * Reconcile watcher state when the icons directory is created or removed.
 * @param {boolean} [shouldSyncPathWatcher]
 * @returns {void}
 */
function syncIconsWatcher(shouldSyncPathWatcher = true) {
    if (shouldSyncPathWatcher) syncPathWatcher();
    const iconsDirExists = existsSync(ICONS_DIR);
    if (iconsDirExists === hasIconsDir) return;
    hasIconsDir = iconsDirExists;
    lastIconsFingerprint = getIconsFingerprint();
    if (iconsDirExists) {
        console.log(`[watch-icons] icons directory detected: ${ICONS_DIR}`);
        startIconsWatcher();
    } else {
        console.log(`[watch-icons] icons directory removed: ${ICONS_DIR}`);
        stopIconsWatcher();
    }
    scheduleRebuild();
}

syncPathWatcher();
if (hasIconsDir) {
    startIconsWatcher();
} else {
    console.log(`[watch-icons] icons directory not found yet: ${ICONS_DIR}`);
}

// Graceful shutdown
process.on('SIGINT', () => {
    if (pathWatcher) pathWatcher.close();
    stopIconsWatcher();
    if (pollTimer) clearInterval(pollTimer);
    process.exit(0);
});
process.on('SIGTERM', () => {
    if (pathWatcher) pathWatcher.close();
    stopIconsWatcher();
    if (pollTimer) clearInterval(pollTimer);
    process.exit(0);
});
