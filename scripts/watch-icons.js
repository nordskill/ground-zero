/**
 * Standalone watcher for the icons folder using Node's native fs.watch API.
 * Regenerates the SVG sprite on any change (add/modify/delete) in the icons directory.
 * 
 * Usage: node scripts/watch-icons.js
 * 
 * This script is designed to run alongside Vite dev server and uses native OS
 * filesystem notifications for maximum V8 performance.
 */
import { watch, existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateSvgSprite } from './svg-sprite.js';

const CWD = process.cwd();
const ICONS_DIR = join(CWD, 'src/assets/icons');
const SPRITE_PARTIAL = join(CWD, 'src/partials/svg-sprite.ejs');

// Debounce timer to batch rapid changes (e.g. bulk delete/paste)
/** @type {ReturnType<typeof setTimeout> | null} */
let debounceTimer = null;
const DEBOUNCE_MS = 20; // Must be < EJS debounce (25ms) to avoid race conditions

async function rebuild() {
    try {
        await generateSvgSprite(ICONS_DIR, SPRITE_PARTIAL);
        console.log('[watch-icons] sprite regenerated');
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[watch-icons] error:', message);
    }
}

function scheduleRebuild() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void rebuild();
    }, DEBOUNCE_MS);
}

// Ensure icons directory exists before watching
if (!existsSync(ICONS_DIR)) {
    console.log(`[watch-icons] icons directory does not exist: ${ICONS_DIR}`);
    console.log('[watch-icons] waiting for directory to be created...');
    // We could poll here, but for now just exit; user can restart after creating dir
    process.exit(0);
}

// Use native fs.watch with recursive option (works on Windows and macOS)
const watcher = watch(ICONS_DIR, { recursive: true }, (eventType, filename) => {
    // Only react to .svg files
    if (!filename || !filename.endsWith('.svg')) return;
    console.log(`[watch-icons] ${eventType}: ${filename}`);
    scheduleRebuild();
});

console.log(`[watch-icons] watching: ${ICONS_DIR}`);

// Graceful shutdown
process.on('SIGINT', () => {
    watcher.close();
    process.exit(0);
});
process.on('SIGTERM', () => {
    watcher.close();
    process.exit(0);
});

