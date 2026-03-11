declare module 'css-tree' {
    export interface CssTreeNode {
        type: string;
    }

    export interface CssTreeDimensionNode extends CssTreeNode {
        type: 'Dimension';
        unit: string;
        value: string | number;
    }

    export type WalkNode = CssTreeNode | CssTreeDimensionNode;

    export function parse(input: string, options?: { context?: string }): unknown;
    export function walk(ast: unknown, callback: (node: WalkNode) => void): void;
    export function generate(ast: unknown): string;
}
