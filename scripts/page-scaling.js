import postcss from 'postcss';
import * as csstree from 'css-tree';
import { loadProjectConfig } from './project-config.js';

/** @type {Readonly<PageScalingConfig>} */
const DEFAULT_PAGE_SCALING_CONFIG = Object.freeze({
    enabled: false,
    minWidth: 1920,
    precision: 2
});
const REGEX_PX_VALUE = /(-?\d*\.?\d+)px\b/gi;

/**
 * @typedef {Object} PageScalingConfig
 * @property {boolean} enabled
 * @property {number} minWidth
 * @property {number} precision
 */

/**
 * Check whether a value is a plain object.
 * @param {unknown} value - Runtime value to inspect.
 * @returns {value is Record<string, unknown>} `true` when the value is a plain object.
 */
function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Check whether a value is a finite number.
 * @param {unknown} value - Runtime value to inspect.
 * @returns {value is number} `true` when the value is a finite number.
 */
function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Check whether a value is a boolean.
 * @param {unknown} value - Runtime value to inspect.
 * @returns {value is boolean} `true` when the value is a boolean.
 */
function isBoolean(value) {
    return typeof value === 'boolean';
}

/**
 * Check whether a CSS Tree node is a dimension node.
 * @param {import('css-tree').WalkNode} node - CSS Tree node.
 * @returns {node is import('css-tree').CssTreeDimensionNode} `true` for dimension nodes.
 */
function isDimensionNode(node) {
    return node.type === 'Dimension';
}

/**
 * Remove insignificant trailing zeros from numeric output.
 * @param {number} value - Number to format.
 * @param {number} precision - Maximum decimal places.
 * @returns {string} CSS-safe number string.
 */
function formatNumber(value, precision) {
    return value
        .toFixed(precision)
        .replace(/\.0+$/, '')
        .replace(/(\.\d*?)0+$/, '$1');
}

/**
 * Convert a pixel value to `vw` relative to the configured threshold width.
 * @param {number} pxValue - Original pixel value.
 * @param {PageScalingConfig} config - Effective scaling config.
 * @returns {string} Converted viewport unit value.
 */
function toViewportWidth(pxValue, config) {
    return `${formatNumber((pxValue * 100) / config.minWidth, config.precision)}vw`;
}

/**
 * Transform one declaration value from `px` to `vw`.
 * Returns an empty string when the declaration should be removed.
 * @param {string} value - Raw declaration value.
 * @param {PageScalingConfig} config - Effective scaling config.
 * @returns {string} Transformed declaration value or an empty string.
 */
function transformDeclarationValue(value, config) {
    if (!value.includes('px')) return '';

    try {
        const ast = csstree.parse(value, { context: 'value' });
        let hasPxDimension = false;

        csstree.walk(ast, (node) => {
            if (!isDimensionNode(node)) {
                return;
            }
            if (node.unit.toLowerCase() !== 'px') {
                return;
            }

            hasPxDimension = true;
            node.value = formatNumber((Number(node.value) * 100) / config.minWidth, config.precision);
            node.unit = 'vw';
        });

        return hasPxDimension ? csstree.generate(ast) : '';
    } catch {
        let hasPxDimension = false;
        const fallback = value.replace(REGEX_PX_VALUE, (_, rawNumber) => {
            hasPxDimension = true;
            return toViewportWidth(Number(rawNumber), config);
        });

        return hasPxDimension ? fallback : '';
    }
}

/**
 * Check whether a PostCSS container still contains any renderable child node.
 * @param {import('postcss').Container} container - Container to inspect.
 * @returns {boolean} `true` when the container still has useful content.
 */
function hasRenderableChildren(container) {
    return Array.isArray(container.nodes) && container.nodes.some((node) => node.type !== 'comment');
}

/**
 * Recursively prune non-scalable nodes and convert `px` declarations to `vw`.
 * Existing `@media` blocks are removed because the new overrides are wrapped
 * into a dedicated media query at the end of the stylesheet.
 * @param {import('postcss').Container} container - Container to mutate.
 * @param {PageScalingConfig} config - Effective scaling config.
 * @returns {void}
 */
function transformContainer(container, config) {
    if (!Array.isArray(container.nodes)) return;

    for (const node of [...container.nodes]) {
        if (node.type === 'comment') continue;

        if (node.type === 'atrule' && node.name.toLowerCase() === 'media') {
            node.remove();
            continue;
        }

        if (node.type === 'decl') {
            const nextValue = transformDeclarationValue(node.value, config);
            if (!nextValue) {
                node.remove();
                continue;
            }

            node.value = nextValue;
            continue;
        }

        if ('nodes' in node && Array.isArray(node.nodes)) {
            transformContainer(node, config);
            if (!hasRenderableChildren(node)) {
                node.remove();
            }
            continue;
        }

        if (node.type === 'atrule') {
            node.remove();
        }
    }
}

/**
 * Build the appended CSS override block for proportional page scaling.
 * @param {string} css - Original stylesheet contents.
 * @param {PageScalingConfig} config - Effective scaling config.
 * @returns {string} Appended media query block, or an empty string when nothing changed.
 */
export function buildPageScalingOverride(css, config) {
    if (!config.enabled) return '';

    const overrideRoot = postcss.parse(css).clone();
    transformContainer(overrideRoot, config);

    if (!hasRenderableChildren(overrideRoot)) {
        return '';
    }

    return `\n@media (min-width: ${formatNumber(config.minWidth, config.precision)}px) {\n${overrideRoot.toString()}\n}\n`;
}

/**
 * Apply proportional page scaling overrides to a stylesheet.
 * @param {string} css - Original stylesheet contents.
 * @param {PageScalingConfig} config - Effective scaling config.
 * @returns {string} Original CSS plus the generated override block.
 */
export function applyPageScalingToCss(css, config) {
    const override = buildPageScalingOverride(css, config);
    return override ? `${css}${override}` : css;
}

/**
 * Load and validate page scaling settings from project config.
 * @returns {Promise<PageScalingConfig>} Effective scaling configuration.
 */
export async function loadPageScalingConfig() {
    const userConfig = await loadProjectConfig();
    const pageScalingValue = userConfig.pageScaling;

    if (pageScalingValue === undefined) {
        return { ...DEFAULT_PAGE_SCALING_CONFIG };
    }
    if (!isPlainObject(pageScalingValue)) {
        throw new Error('Expected "pageScaling" in ground-zero config to be an object');
    }

    const enabledValue = pageScalingValue.enabled;
    if (enabledValue !== undefined && !isBoolean(enabledValue)) {
        throw new Error('Expected "pageScaling.enabled" in ground-zero config to be a boolean');
    }

    const minWidthValue = pageScalingValue.minWidth;
    if (minWidthValue !== undefined && (!isFiniteNumber(minWidthValue) || minWidthValue <= 0)) {
        throw new Error('Expected "pageScaling.minWidth" in ground-zero config to be a positive number');
    }

    const precisionValue = pageScalingValue.precision;
    if (
        precisionValue !== undefined
        && (!isFiniteNumber(precisionValue) || !Number.isInteger(precisionValue) || precisionValue < 0 || precisionValue > 6)
    ) {
        throw new Error('Expected "pageScaling.precision" in ground-zero config to be an integer between 0 and 6');
    }

    return {
        enabled: isBoolean(enabledValue) ? enabledValue : DEFAULT_PAGE_SCALING_CONFIG.enabled,
        minWidth: isFiniteNumber(minWidthValue) ? minWidthValue : DEFAULT_PAGE_SCALING_CONFIG.minWidth,
        precision: isFiniteNumber(precisionValue) ? precisionValue : DEFAULT_PAGE_SCALING_CONFIG.precision
    };
}
