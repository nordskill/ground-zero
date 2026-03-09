import { existsSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CWD = process.cwd();
const CONFIG_FILES = [
    'gzero.config.js',
    'gzero.config.mjs',
    'ground-zero.config.js',
    'ground-zero.config.mjs'
];

/**
 * Check whether a value is a plain object that can act as config.
 * @param {unknown} value - Runtime value to validate.
 * @returns {value is Record<string, unknown>} `true` when the value is a plain object.
 */
function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Load the first supported project config file from the current workspace.
 * @returns {Promise<Record<string, unknown>>} User config object, or an empty object when missing.
 */
export async function loadProjectConfig() {
    for (const configName of CONFIG_FILES) {
        const configPath = pathResolve(CWD, configName);
        if (!existsSync(configPath)) continue;

        const configModule = /** @type {Record<string, unknown> & { default?: unknown }} */ (
            await import(`${pathToFileURL(configPath).href}?ts=${Date.now()}`)
        );
        const userConfig = configModule.default ?? configModule;

        if (isPlainObject(userConfig)) {
            return userConfig;
        }

        return {};
    }

    return {};
}
