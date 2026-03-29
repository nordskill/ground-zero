declare module 'browser-sync' {
    interface BrowserSyncUrls {
        external?: string;
        local?: string;
        ui?: string;
    }

    interface BrowserSyncInitOptions {
        codeSync?: boolean;
        logLevel?: string;
        notify?: boolean;
        open?: boolean | string;
        port?: number;
        proxy?: {
            target: string;
            ws?: boolean;
        };
    }

    interface BrowserSyncInstance {
        exit(): void;
        getOption(name: 'urls'): {
            toJS(): BrowserSyncUrls;
        };
        init(options: BrowserSyncInitOptions, callback: (error?: Error) => void): void;
    }

    interface BrowserSyncModule {
        create(name?: string): BrowserSyncInstance;
    }

    const browserSync: BrowserSyncModule;
    export default browserSync;
}
