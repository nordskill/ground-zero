declare module 'html-minifier-terser' {
    export interface MinifyOptions {
        collapseWhitespace?: boolean;
        conservativeCollapse?: boolean;
    }

    export function minify(input: string, options?: MinifyOptions): Promise<string>;
}
declare module 'html-minifier-terser' {
    export interface HtmlMinifierOptions {
        collapseWhitespace?: boolean;
        conservativeCollapse?: boolean;
        [key: string]: unknown;
    }

    export function minify(
        input: string,
        options?: HtmlMinifierOptions
    ): Promise<string>;
}
