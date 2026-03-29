# Ground Zero

Ground Zero (`ground-zero`) is a zero-config static site generator that wraps Vite, EJS templates, and modern CSS. Install it, run one command, and you get hot module reloading, BrowserSync mirroring, and production builds without writing any config files.

Requires Node.js 22.12 or newer.

## Why Ground Zero?

- Zero setup: Vite config, BrowserSync, and file watching are bundled, so you only write templates and CSS.
- Pure EJS + CSS: No React, no SCSS pipeline, just standard EJS partials and native CSS features.
- Instant feedback: Vite's HMR keeps the browser in sync while BrowserSync mirrors clicks, scroll, and form inputs across devices.
- Predictable builds: Every build runs `EJS -> Vite build -> responsive images -> asset copy -> HTML minify -> CSS minify`, so what you preview is what you ship.

## Project structure

Ground Zero expects a few core folders and one config file:

- **`src/pages/`** — Your EJS templates. Each `.ejs` file here becomes a clean-URL page (e.g. `about.ejs` → `/about/`).
- **`src/assets/`** — Images, CSS, JS, icons, video, PDFs, and anything else your site needs. In templates, reference these files with `/assets/` URLs (e.g. `/assets/images/me.jpg`). During a production build they end up in `build/assets/`.
- **`src/data/`** — Optional global JSON data. Every `.json` file here is loaded once and exposed to all EJS templates as `globalData`.
- **`public/`** — Files that should appear at the root of your site exactly as-is, like `favicon.ico` or `manifest.webmanifest`. Do not put a `robots.txt` here — the build generates one automatically.
- **`gzero.config.js`** — Project-level settings (see Responsive images below).
There is also a special template variable called `moduleEntry`. It points to `src/assets/js/main.js` so Vite can bundle your JavaScript. Use it in a template like this:

```ejs
<script type="module" src="<%= moduleEntry %>"></script>
```

### Global JSON data

Put shared JSON files anywhere under `src/data/`. Ground Zero mirrors the folder structure into one `globalData` object that every EJS template and partial can read.

Examples:

- `src/data/company.json` -> `globalData.company`
- `src/data/projects/featured.json` -> `globalData.projects.featured`

```ejs
<footer>
    <a href="mailto:<%= globalData.company.email %>"><%= globalData.company.email %></a>
</footer>
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

## Page scaling

### Problem
On UltraHD, 4K, and larger screens, pixel-based layouts stay fixed-size while the viewport keeps growing. Content becomes a narrow strip flanked by vast empty space. Meanwhile, people tend to sit further from large monitors, so normally-sized text becomes hard to read without leaning in.

### Solution
When you build for production, Ground Zero can automatically make your layout scale proportionally on large viewports. It does this by appending a `@media` override block to each CSS file where every `px` value is converted to a `vw` value relative to the configured `minWidth`. Viewports narrower than `minWidth` are unaffected — your source CSS is unchanged.

Enable it in `gzero.config.js`:

```js
export default {
    pageScaling: {
        enabled: true,
        minWidth: 1920,
        precision: 2
    }
};
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Turn page scaling on or off. |
| `minWidth` | number | `1920` | Viewport width in px where scaling kicks in. All `px` values in your CSS are converted relative to this number. |
| `precision` | number | `2` | Decimal places for the generated `vw` values. Integer from 0 to 6. |

This runs during the production build, just before CSS minification. Existing `@media` blocks inside your CSS are not carried over into the override block — only bare rule declarations are scaled.

## Sitemap and robots.txt

When you build for production, Ground Zero automatically generates `build/sitemap.xml` and `build/robots.txt` from your pages and config. Set `siteUrl` in `gzero.config.js` to activate this:

```js
export default {
    siteUrl: 'https://example.com',
    sitemap: {
        defaults: {
            changefreq: 'monthly',
            priority: 0.5
        }
    },
    robots: {
        disallow: ['/admin']
    }
};
```

Every `.ejs` file in `src/pages/` gets a sitemap entry. The URL is derived from the file path:

- `src/pages/index.ejs` → `/`
- `src/pages/about.ejs` → `/about/`
- `src/pages/blog/index.ejs` → `/blog/`
- `src/pages/blog/post.ejs` → `/blog/post/`

### Per-page sitemap metadata

To override defaults or exclude a page from the sitemap, add a `@ground-zero-sitemap` block inside an EJS comment at the top of the template:

```ejs
<%#
@ground-zero-sitemap
{
    "changefreq": "weekly",
    "priority": 1,
    "exclude": false
}
%>
```

| Field | Type | Description |
|-------|------|-------------|
| `changefreq` | string | One of `always`, `hourly`, `daily`, `weekly`, `monthly`, `yearly`, `never` |
| `priority` | number | Between `0.0` and `1.0` |
| `exclude` | boolean | Set to `true` to omit this page from the sitemap entirely |

Fields not set in the block fall back to `sitemap.defaults` from `gzero.config.js`.

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

mkdir -p src/pages src/partials src/data src/assets/css src/assets/js src/assets/icons src/assets/images src/assets/video public
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
8. Generates `build/sitemap.xml` and `build/robots.txt` from page metadata and `gzero.config.js`.
9. Minifies every HTML file in `build/`.
10. Appends page scaling overrides to CSS files when `pageScaling.enabled` is true, then minifies every CSS file in `build/` using esbuild.
11. Removes the temporary production HTML cache on success.

Deploy the `build/` folder to any static host.

## Upgrading to Ground Zero 2 / Vite 8

Ground Zero 2 ships with Vite 8.

Breaking change:

- Node.js 22.12 or newer is now required.

Migration steps:

1. Update Node.js to 22.12 or newer.
2. Reinstall dependencies in your project.
3. Run `npx gzero` and `npx gzero-build`.
4. Test your site in the browsers you support, especially if you relied on Vite's previous default browser target.

Your Ground Zero templates, partials, `src/data/`, and CLI commands do not need any new migration steps beyond that.

For the general Vite 8 migration rules, see the official Vite migration guide: https://vite.dev/guide/migration

## License

MIT © Ground Zero contributors.




