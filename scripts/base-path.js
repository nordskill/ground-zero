import { loadProjectConfig } from './project-config.js';

/**
 * Split a URL-like value into pathname and trailing query/hash suffix.
 * @param {string} value - URL or path fragment.
 * @returns {{ path: string, suffix: string }} Parsed value parts.
 */
function splitUrlSuffix(value) {
    const suffixIndex = value.search(/[?#]/);
    if (suffixIndex === -1) {
        return { path: value, suffix: '' };
    }

    return {
        path: value.slice(0, suffixIndex),
        suffix: value.slice(suffixIndex)
    };
}

/**
 * Check whether a value is a non-path URL or browser-only reference.
 * @param {string} value - Raw URL-like value.
 * @returns {boolean} `true` when the value should not be base-prefixed.
 */
function isSpecialUrl(value) {
    return value.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//');
}

/**
 * Normalize a configured deploy base path to leading and trailing slashes.
 * @param {unknown} value - Raw config value.
 * @returns {string} Normalized base path.
 */
export function normalizeBasePath(value) {
    if (value === undefined || value === null) {
        return '/';
    }
    if (typeof value !== 'string') {
        throw new Error('Expected "basePath" in ground-zero config to be a string');
    }

    const trimmedValue = value.trim().replaceAll('\\', '/');
    if (!trimmedValue || trimmedValue === '/') {
        return '/';
    }

    const { path, suffix } = splitUrlSuffix(trimmedValue);
    if (suffix) {
        throw new Error('"basePath" in ground-zero config must not contain query or hash segments');
    }
    if (isSpecialUrl(path)) {
        throw new Error('"basePath" in ground-zero config must be a path like "/docs/"');
    }

    const segments = path.split('/').filter(Boolean);
    if (segments.some((segment) => segment === '.' || segment === '..')) {
        throw new Error('"basePath" in ground-zero config must not contain "." or ".." segments');
    }

    return segments.length ? `/${segments.join('/')}/` : '/';
}

/**
 * Prefix an internal URL path with the configured deploy base path.
 * @param {string} value - Internal URL or path fragment.
 * @param {string} [basePath='/'] - Normalized or raw deploy base path.
 * @returns {string} Base-aware URL.
 */
export function withBase(value, basePath = '/') {
    const normalizedBasePath = normalizeBasePath(basePath);
    const normalizedValue = String(value ?? '').trim().replaceAll('\\', '/');
    if (!normalizedValue) {
        return normalizedBasePath;
    }
    if (isSpecialUrl(normalizedValue)) {
        return normalizedValue;
    }

    const { path, suffix } = splitUrlSuffix(normalizedValue);
    if (!path || path === '/') {
        return `${normalizedBasePath}${suffix}`;
    }

    const rootPath = path.startsWith('/') ? path : `/${path}`;
    if (normalizedBasePath === '/') {
        return `${rootPath}${suffix}`;
    }

    const baseRoot = normalizedBasePath.slice(0, -1);
    return `${baseRoot}${rootPath}${suffix}`;
}

/**
 * Remove the configured deploy base path from an internal URL.
 * @param {string} value - Internal URL or path fragment.
 * @param {string} [basePath='/'] - Normalized or raw deploy base path.
 * @returns {string} Root-relative URL without the deploy base prefix.
 */
export function stripBasePath(value, basePath = '/') {
    const normalizedBasePath = normalizeBasePath(basePath);
    const normalizedValue = String(value ?? '').trim().replaceAll('\\', '/');
    if (!normalizedValue) {
        return '/';
    }
    if (isSpecialUrl(normalizedValue)) {
        return normalizedValue;
    }

    const { path, suffix } = splitUrlSuffix(normalizedValue);
    const rootPath = !path || path === '/' ? '/' : path.startsWith('/') ? path : `/${path}`;
    if (normalizedBasePath === '/') {
        return `${rootPath}${suffix}`;
    }

    const baseRoot = normalizedBasePath.slice(0, -1);
    if (rootPath === baseRoot) {
        return `/${suffix}`;
    }
    if (!rootPath.startsWith(normalizedBasePath)) {
        return `${rootPath}${suffix}`;
    }

    const strippedPath = rootPath.slice(normalizedBasePath.length - 1);
    return `${strippedPath || '/'}${suffix}`;
}

/**
 * Load and normalize the project deploy base path from config.
 * @returns {Promise<string>} Normalized base path.
 */
export async function loadBasePath() {
    const userConfig = await loadProjectConfig();
    return normalizeBasePath(userConfig.basePath);
}
