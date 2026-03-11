export default {
    siteUrl: 'https://my-site.com',
    imageConversion: {
        format: 'avif',
        quality: 70,
        sizes: [480, 960, 1440],
        injectIntrinsicSize: true
    },
    pageScaling: {
        enabled: false,
        minWidth: 1920,
        precision: 2
    },
    sitemap: {
        defaults: {
            changefreq: 'monthly',
            priority: 0.5
        }
    },
    robots: {
        disallow: ['/*.md$']
    }
};
