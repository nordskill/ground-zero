import { readdir, readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, extname, resolve as pathResolve } from 'node:path';
import { optimize } from 'svgo';

const SVG_OPEN_TAG_RE = /<svg\b[^>]*>/i;

/**
 * Transform a raw SVG file into a <symbol> element string.
 * Keeps viewBox and other useful attributes while normalizing and
 * stripping sizing-related attributes that should come from CSS.
 *
 * @param {string} id - Symbol id attribute (e.g. "icon-home")
 * @param {string} source - Raw SVG file contents
 * @returns {string | null} - Symbol markup or null if no <svg> tag found
 */
function svgToSymbol(id, source) {
    const str = typeof source === 'string' ? source : String(source);

    const openMatch = SVG_OPEN_TAG_RE.exec(str);
    if (!openMatch) return null;

    const openTag = openMatch[0];
    const openIndex = openMatch.index;
    const afterOpen = openIndex + openTag.length;

    const lower = str.toLowerCase();
    const closeIndex = lower.lastIndexOf('</svg>');
    const inner = closeIndex === -1 ? str.slice(afterOpen) : str.slice(afterOpen, closeIndex);

    // Sprite-specific transformation: convert <svg> to <symbol>
    let symbolTag = openTag.replace(/<svg\b/i, `<symbol id="${id}"`);

    // Normalize inner content: trim and remove all newlines/whitespace to keep symbol on one line
    const innerTrimmed = inner.trim().replace(/\s+/g, ' ');
    const content = innerTrimmed || '';

    return `${symbolTag}${content}</symbol>`;
}

/**
 * Convert file name to a stable, ID-safe symbol name.
 * Example: "home.svg" -> "icon-home"
 *
 * @param {string} fileName
 * @returns {string}
 */
function makeSymbolId(fileName) {
    const base = fileName.replace(/\.svg$/i, '').trim();
    const slug = base.toLowerCase().replace(/\s+/g, '-');
    return `icon-${slug}`;
}

/**
 * Generate a single SVG sprite from all .svg files in a directory.
 * The sprite is written as a plain string (e.g. .ejs partial) to the output file.
 * This helper is intentionally self-contained so that SVGO or other processing
 * can be added later at a single integration point.
 *
 * @param {string} iconsDirPath - Path to the folder with source SVG icons
 * @param {string} outputFilePath - Path to the generated sprite file (e.g. ./src/partials/svg-sprite.ejs)
 * @returns {Promise<void>}
 */
export async function generateSvgSprite(iconsDirPath, outputFilePath) {
    const cwd = process.cwd();
    const iconsDirAbs = pathResolve(cwd, iconsDirPath);
    const outputFileAbs = pathResolve(cwd, outputFilePath);

    /** @type {import('node:fs').Dirent[]} */
    let dirEntries;
    try {
        dirEntries = await readdir(iconsDirAbs, { withFileTypes: true });
    } catch (err) {
        // If icons directory does not exist, still emit an empty sprite to avoid template failures.
        if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
            const emptySprite = `<svg class="svg_sprite" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden">
</svg>\n`;
            const existing = await readFile(outputFileAbs, 'utf8').catch(() => '');
            if (existing === emptySprite) return;
            await mkdir(dirname(outputFileAbs), { recursive: true });
            // Atomic write: temp file + rename to avoid partial reads
            const tmpFile = `${outputFileAbs}.tmp`;
            await writeFile(tmpFile, emptySprite, 'utf8');
            await rename(tmpFile, outputFileAbs);
            return;
        }
        throw err;
    }

    const svgFiles = dirEntries
        .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.svg')
        .map((entry) => entry.name)
        .sort();

    // Read and transform all SVGs in parallel for throughput.
    /** @type {{ fileName: string; symbol: string }[]} */
    const symbols = [];
    await Promise.all(
        svgFiles.map(async (fileName) => {
            const filePath = pathResolve(iconsDirAbs, fileName);
            const raw = await readFile(filePath, 'utf8');
            
            // Reference: https://svgo.dev/docs/preset-default/
            const optimized = optimize(raw, {
                plugins: [
                    {
                        name: 'preset-default',
                        params: {
                            overrides: {
                                // Keep IDs for sprite symbols (they're needed for <use> references)
                                cleanupIds: false,
                                cleanupNumericValues: {
                                    floatPrecision: 3,
                                },
                                convertTransform: {
                                    floatPrecision: 4,
                                },
                            },
                        },
                    },
                    'removeDimensions',
                    'removeXMLNS',
                    'removeXlink',
                    {
                        name: 'removeAttrs',
                        params: {
                            // the fill and stroke colors should be defined in CSS depending on the context
                            attrs: '(fill|stroke)',
                        },
                    },
                ],
            });

            const id = makeSymbolId(fileName);
            const symbol = svgToSymbol(id, optimized.data);
            if (symbol) {
                symbols.push({ fileName, symbol });
            }
        })
    );

    // Ensure deterministic ordering in the final sprite for stable builds.
    symbols.sort((a, b) => (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0));

    const body = symbols.length > 0 ? symbols.map((s) => s.symbol).join('\n') : '';

    const sprite = `<svg class="svg_sprite" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden">
${body}
</svg>\n`;

    // Only write if content changed to avoid triggering unnecessary EJS recompilation
    const existing = await readFile(outputFileAbs, 'utf8').catch(() => '');
    if (existing === sprite) return;

    await mkdir(dirname(outputFileAbs), { recursive: true });
    // Atomic write: temp file + rename to avoid partial reads
    const tmpFile = `${outputFileAbs}.tmp`;
    await writeFile(tmpFile, sprite, 'utf8');
    await rename(tmpFile, outputFileAbs);
}
