# Ground Zero

Ground Zero (`ground-zero`) is a zero-config static site generator that wraps Vite, EJS templates, and modern CSS. Install it, run one command, and you get hot module reloading, BrowserSync mirroring, and production builds without writing any config files.

## Why Ground Zero?

- **Zero setup:** Vite config, BrowserSync, and file watching are bundled, so you only write templates and CSS.
- **Pure EJS + CSS:** No React, no SCSS pipeline—just standard EJS partials and native CSS features (nesting, layers, imports).
- **Instant feedback:** Vite's HMR keeps the browser in sync while BrowserSync mirrors clicks, scroll, and form inputs across devices.
- **Predictable builds:** Every build runs `EJS → Vite build → CSS minify`, so what you preview is what you ship.

## Core concepts

| Concept | What it means |
| --- | --- |
| **EJS pages** | Files under `src/pages/**/*.ejs` compile into matching `.html` pages for development and production. |
| **Module entry** | `src/assets/js/main.js` is exposed to templates as `moduleEntry`. Add `<script type="module" src="<%= moduleEntry %>"></script>` to pages that need JS. |
| **Responsive images** | Drop source images into `src/assets/images/`, author a plain `<img>` tag, and Ground Zero rewrites it into a responsive `srcset` image during production builds. |
| **One-click commands** | `gzero` runs the dev loop (compile + Vite serve). `gzero-build` compiles, then minifies CSS with esbuild. |
| **Modern CSS** | Write plain `.css` files that use nesting, layers, imports, and variables—Vite handles the rest. |

## EJS comments

Ground Zero supports multiline comments that can contain EJS tags inside them. Anything between `<%#` and `%>` is stripped out during compilation:

```ejs
<%#
This entire block is removed from the output.
You can even put EJS tags here and they won't run:
<%- include('../partials/example') %>
%>
```

This is useful for temporarily disabling sections of a template or leaving notes for yourself.

## SVG icons

Put your `.svg` files in `src/assets/icons/`. Ground Zero automatically generates a sprite file and watches that folder for changes during development. If the folder does not exist yet, Ground Zero will start watching it as soon as you create it.

To use icons in a template:

1. Include the sprite once per page (usually right after `<body>`):

```ejs
<%- include('../partials/svg-sprite') %>
```

2. Reference icons by filename using `<use>`:

```html
<svg style="width: 24px; height: 24px;">
    <use href="#icon-home"></use>
</svg>
```

The icon ID follows the pattern `#icon-{filename}` — so `home.svg` becomes `#icon-home`.

## Quick start

```bash
mkdir my-site && cd my-site
npm init -y
npm install @nordskill/ground-zero

# minimal structure
mkdir -p src/pages src/partials src/assets/css src/assets/js src/assets/icons src/assets/images
touch src/pages/index.ejs src/assets/css/main.css src/assets/js/main.js
```

Example `src/pages/index.ejs`:

```html
<!DOCTYPE html>
<html lang="en">
  <%- include('../partials/head') %>
  <body>
    <%- include('../partials/svg-sprite') %>
    <%- include('../partials/header') %>
    <main>
      <h1>Hello from Ground Zero</h1>
    </main>
    <%- include('../partials/footer') %>
    <script type="module" src="<%= moduleEntry %>"></script>
  </body>
</html>
```

### Develop with HMR

```bash
npx gzero
```

This command:
1. Compiles all EJS pages into `dev-html/`.
2. Starts Vite with HMR so you see changes immediately.
3. Keeps BrowserSync in sync across open devices.

### Build for production

```bash
npx gzero-build
```

This command:
1. Recompiles EJS → HTML.
2. Compiles production HTML into a fresh temporary cache and runs `vite build` from there.
3. Converts `src/assets/images/` into responsive assets in `build/images/`.
4. Minifies every CSS file in `build/` using esbuild.
5. Removes the temporary production HTML cache on success.

Deploy the `build/` folder to any static host.

## Responsive images

Author plain image tags in EJS and point `src` at a file inside `src/assets/images/`:

```html
<img src="/src/assets/images/me.jpg" alt="Photo of me" />
```

If you need a specific `sizes` value, write it on the tag yourself and Ground Zero will preserve it:

```html
<img
    src="/src/assets/images/me.jpg"
    alt="Photo of me"
    sizes="(max-width: 768px) 100vw, 500px"
/>
```

Image conversion settings live in `gzero.config.js` at the project root.
Example config:

```js
export default {
    imageConversion: {
        format: 'avif',
        sizes: [480, 960, 1440],
        injectIntrinsicSize: true
    }
};
```

Notes:

- `format` is passed directly to Sharp.
- `quality` is optional; if omitted, Sharp uses its own default.
- `sizes` is an array of target widths; Ground Zero also keeps the original width when needed to avoid upscaling.
- `sizes` is not auto-generated. If you omit it, the output tag omits it too.
- `injectIntrinsicSize` controls whether Ground Zero adds intrinsic `width` and `height` attributes to the output image tag.
- `svg` files are copied through to `build/images/` without responsive conversion.

## License

MIT © Ground Zero contributors.
