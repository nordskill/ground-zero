import { relative as pathRelative } from 'node:path';

/**
 * Normalize Windows separators for URL and relative path usage.
 * @param {string} value - File system path fragment.
 * @returns {string} Path with forward slashes.
 */
function normalizeSlashes(value) {
    return value.replaceAll('\\', '/');
}

/**
 * Resolve a page file into its public route and HTML output path.
 * @param {string} pagesDir - Absolute `src/pages` directory.
 * @param {string} pageFile - Absolute page file path.
 * @returns {{ route: string, outputRelativePath: string, templateRelativePath: string }}
 */
export function getPagePathInfo(pagesDir, pageFile) {
    const templateRelativePath = normalizeSlashes(pathRelative(pagesDir, pageFile));
    const routePath = templateRelativePath.replace(/\.ejs$/i, '');

    if (routePath === 'index') {
        return {
            route: '/',
            outputRelativePath: 'index.html',
            templateRelativePath
        };
    }

    if (routePath.endsWith('/index')) {
        return {
            route: encodeURI(`/${routePath.slice(0, -'/index'.length)}/`),
            outputRelativePath: `${routePath}.html`,
            templateRelativePath
        };
    }

    return {
        route: encodeURI(`/${routePath}/`),
        outputRelativePath: `${routePath}/index.html`,
        templateRelativePath
    };
}

/**
 * Fail fast when two templates target the same output HTML file.
 * @param {string} pagesDir - Absolute `src/pages` directory.
 * @param {string[]} pageFiles - Absolute page file paths.
 * @returns {void}
 */
export function assertNoPageOutputCollisions(pagesDir, pageFiles) {
    /** @type {Map<string, string>} */
    const seenOutputs = new Map();

    for (const pageFile of pageFiles) {
        const pageInfo = getPagePathInfo(pagesDir, pageFile);
        const existingPage = seenOutputs.get(pageInfo.outputRelativePath);
        if (!existingPage) {
            seenOutputs.set(pageInfo.outputRelativePath, pageInfo.templateRelativePath);
            continue;
        }

        throw new Error(
            `Ground Zero cannot continue because "${existingPage}" and "${pageInfo.templateRelativePath}" `
            + `both map to "${pageInfo.outputRelativePath}". Rename one of those page files so each page has its own URL.`
        );
    }
}
