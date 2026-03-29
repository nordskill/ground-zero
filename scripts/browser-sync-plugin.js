import browserSync from 'browser-sync';

const DEFAULT_VITE_DEV_PORT = 5173;
const DEFAULT_BROWSER_SYNC_PORT = 3000;
const BROWSER_SYNC_NAME = 'ground-zero-browser-sync';

/**
 * Start a BrowserSync proxy alongside the Vite dev server.
 * @returns {import('vite').Plugin} Vite plugin definition.
 */
export function browserSyncPlugin() {
    /** @type {ReturnType<typeof browserSync.create> | null} */
    let browserSyncInstance = null;
    let hasStarted = false;

    return {
        name: 'ground-zero-browser-sync',
        apply: 'serve',
        configureServer(server) {
            const httpServer = server.httpServer;
            if (!httpServer) return;

            if (httpServer.listening) {
                void startBrowserSync(server);
            } else {
                httpServer.once('listening', handleServerListening);
            }

            httpServer.once('close', handleServerClose);
            process.once('SIGINT', handleProcessExit);
            process.once('SIGTERM', handleProcessExit);

            function handleServerListening() {
                void startBrowserSync(server);
            }

            function handleServerClose() {
                stopBrowserSync();
            }

            function handleProcessExit() {
                stopBrowserSync();
                process.exit(0);
            }
        }
    };

    /**
     * Start BrowserSync once the Vite server is ready.
     * @param {import('vite').ViteDevServer} server - Active Vite dev server.
     * @returns {Promise<void>}
     */
    async function startBrowserSync(server) {
        if (hasStarted) return;
        hasStarted = true;

        const target = resolveProxyTarget(server);
        browserSyncInstance = browserSync.create(BROWSER_SYNC_NAME);

        try {
            await new Promise((resolve, reject) => {
                if (!browserSyncInstance) {
                    reject(new Error('BrowserSync could not be created.'));
                    return;
                }

                browserSyncInstance.init(
                    {
                        codeSync: false,
                        logLevel: 'silent',
                        notify: false,
                        open: 'local',
                        port: DEFAULT_BROWSER_SYNC_PORT,
                        proxy: {
                            target,
                            ws: true
                        }
                    },
                    handleBrowserSyncInit
                );

                /**
                 * Finish BrowserSync startup.
                 * @param {Error | undefined} error - BrowserSync startup error.
                 * @returns {void}
                 */
                function handleBrowserSyncInit(error) {
                    if (error) {
                        reject(error);
                        return;
                    }

                    resolve(undefined);
                }
            });
            logBrowserSyncUrls(server);
        } catch (error) {
            hasStarted = false;
            stopBrowserSync();
            const errorMessage = error instanceof Error ? error.message : String(error);
            server.config.logger.error(`[browser-sync] ${errorMessage}`);
        }
    }

    /**
     * Resolve the Vite dev server URL for the BrowserSync proxy target.
     * @param {import('vite').ViteDevServer} server - Active Vite dev server.
     * @returns {string} Proxy target URL.
     */
    function resolveProxyTarget(server) {
        const resolvedLocalUrl = server.resolvedUrls?.local[0];
        if (resolvedLocalUrl) return resolvedLocalUrl;

        const isHttps = Boolean(server.config.server.https);
        const protocol = isHttps ? 'https' : 'http';
        const port = server.config.server.port ?? DEFAULT_VITE_DEV_PORT;
        return `${protocol}://localhost:${port}/`;
    }

    /**
     * Print BrowserSync URLs once the proxy is running.
     * @param {import('vite').ViteDevServer} server - Active Vite dev server.
     * @returns {void}
     */
    function logBrowserSyncUrls(server) {
        if (!browserSyncInstance) return;

        /** @type {any} */
        const urls = browserSyncInstance.getOption('urls').toJS();
        if (urls.local) {
            server.config.logger.info(`  ➜  BrowserSync: ${urls.local}`);
        }
        if (urls.external) {
            server.config.logger.info(`  ➜  BrowserSync External: ${urls.external}`);
        }
        if (urls.ui) {
            server.config.logger.info(`  ➜  BrowserSync UI: ${urls.ui}`);
        }
    }

    /**
     * Stop the active BrowserSync instance.
     * @returns {void}
     */
    function stopBrowserSync() {
        if (!browserSyncInstance) return;
        browserSyncInstance.exit();
        browserSyncInstance = null;
        hasStarted = false;
    }
}
