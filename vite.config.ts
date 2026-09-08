import { defineConfig, loadEnv, type Plugin } from 'vite'

/**
 * Social cards want absolute image URLs. The deploy host is not known at build
 * time, so set SITE_URL (in .env, or the environment) to have them rewritten.
 * Without it the relative paths are left alone, which most scrapers still
 * resolve against the page.
 */
function absoluteSocialUrls(site: string | undefined): Plugin {
  return {
    name: 'absolute-social-urls',
    transformIndexHtml(html) {
      if (!site) return html
      const base = site.replace(/\/*$/, '/')
      return html
        .replace(/(content=")og\.png(")/g, `$1${base}og.png$2`)
        .replace(
          '<meta property="og:type"',
          `<meta property="og:url" content="${base}" />\n    <meta property="og:type"`,
        )
    },
  }
}

export default defineConfig(({ mode }) => {
  // Loads every key, not just the VITE_ prefixed ones, so SITE_URL can live in .env.
  const env = loadEnv(mode, process.cwd(), '')
  return {
    base: './',
    plugins: [absoluteSocialUrls(env.SITE_URL)],
    server: { port: 5173 },
    build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  }
})
