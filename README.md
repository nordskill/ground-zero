# Ground Zero

Ground Zero (`ground-zero`) is a zero-config static site generator that wraps Vite, EJS templates, and modern CSS. Install it, run one command, and you get hot module reloading, BrowserSync mirroring, and production builds without writing any config files.

## Why Ground Zero?

- Zero setup: Vite config, BrowserSync, and file watching are bundled, so you only write templates and CSS.
- Pure EJS + CSS: No React, no SCSS pipeline, just standard EJS partials and native CSS features.
- Instant feedback: Vite's HMR keeps the browser in sync while BrowserSync mirrors clicks, scroll, and form inputs across devices.
- Predictable builds: Every build runs `EJS -> Vite build -> responsive images -> asset copy -> CSS minify`, so what you preview is what you ship.

## Project structure

Ground Zero expects three folders and one config file:

- **`src/pages/`** — Your EJS templates. Each `.ejs` file here becomes an `.html` page.
- **`src/assets/`** — Images, CSS, JS, icons, video, PDFs, and anything else your site needs. In templates, reference these files with `/assets/` URLs (e.g. `/assets/images/me.jpg`). During a production build they end up in `build/assets/`.
- **`public/`** — Files that should appear at the root of your site exactly as-is, like `favicon.ico`, `robots.txt`, or `manifest.webmanifest`.
- **`gzero.config.js`** — Project-level settings (see Responsive images below).

There is also a special template variable called `moduleEntry`. It points to `src/assets/js/main.js` so Vite can bundle your JavaScript. Use it in a template like this:

```ejs
<script type="module" src="<%= moduleEntry %>"></script>
```

### Referencing assets in templates

Always use `/assets/` paths — Ground Zero takes care of the rest:

```ejs
<img src="/assets/images/me.jpg" alt="Photo of me">
<video autoplay muted loop playsinline>
    <source src="/assets/video/showreel.webm" type="video/webm">
    <source src="/assets/video/showreel.mp4" type="video/mp4">
</video>
<a href="/assets/pdf/portfolio.pdf">Download PDF</a>
```

## Responsive images

When you build for production, Ground Zero takes every raster image in `src/assets/images/` and converts it into multiple sizes and a modern format based on your config. Just write a normal `<img>` tag in your template — the build rewrites it into a responsive `<picture>` or `srcset` automatically.

SVG files are copied through unchanged. If you add a `sizes` attribute, it is preserved. You can also have the build inject the intrinsic `width` and `height` for you.

Example `gzero.config.js`:

```js
export default {
    imageConversion: {
        format: 'avif',
        quality: 70,
        sizes: [480, 960, 1440],
        injectIntrinsicSize: true
    }
};
```

## EJS comments

Ground Zero supports multiline comments that can contain EJS tags inside them. Anything between `<%#` and `%>` is stripped out during compilation:

```ejs
<%#
This entire block is removed from the output.
You can even put EJS tags here and they won't run:
<%- include('../partials/example') %>
%>
```

## SVG icons

Put your `.svg` files in `src/assets/icons/`. Ground Zero automatically generates a sprite file and watches that folder for changes during development.

To use icons in a template:

1. Include the sprite once per page, usually right after `<body>`.
```ejs
<%- include('../partials/svg-sprite') %>
```
2. Reference icons by filename using `<use>`.
```html
<svg style="width: 24px; height: 24px;">
    <use href="#icon-home"></use>
</svg>
```

The icon ID follows the pattern `#icon-{filename}`, so `home.svg` becomes `#icon-home`.

## Quick start

```bash
mkdir my-site && cd my-site
npm init -y
npm install @nordskill/ground-zero

mkdir -p src/pages src/partials src/assets/css src/assets/js src/assets/icons src/assets/images src/assets/video public
touch src/pages/index.ejs src/assets/css/main.css src/assets/js/main.js gzero.config.js
```

Example `src/pages/index.ejs`:

```ejs
<!doctype html>
<html lang="en">
  <%- include('../partials/head') %>
  <body>
    <%- include('../partials/svg-sprite') %>
    <%- include('../partials/header') %>
    <main>
      <h1>Hello from Ground Zero</h1>
      <img src="/assets/images/me.jpg" alt="Photo of me">
    </main>
    <script type="module" src="<%= moduleEntry %>"></script>
  </body>
</html>
```

## Develop with HMR

```bash
npx gzero
```

This command:
1. Compiles all EJS pages into `dev-html/`.
2. Starts Vite with HMR so you see changes immediately.
3. Serves `src/assets/**` from `/assets/**` URLs.
4. Keeps BrowserSync in sync across open devices.

## Build for production

```bash
npx gzero-build
```

This command:
1. Recompiles EJS to HTML.
2. Rewrites image tags from `src/assets/images` into responsive production output based on `gzero.config.js`.
3. Compiles production HTML into a fresh temporary cache and runs `vite build` from there.
4. Emits Vite-managed CSS and JS bundles into `build/assets/css` and `build/assets/js`.
5. Writes responsive image output to `build/assets/images`.
6. Copies other static source assets such as icons, video, and PDFs into `build/assets/**`.
7. Copies `public/**` through unchanged.
8. Minifies every CSS file in `build/` using esbuild.
9. Removes the temporary production HTML cache on success.

Deploy the `build/` folder to any static host.

## License

MIT © Ground Zero contributors.
