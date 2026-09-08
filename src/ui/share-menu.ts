/**
 * Ways to pass a sign along. The link already holds the whole design, so every
 * option here is just that link with a different wrapper around it.
 */
export interface ShareTarget {
  name: string
  /** Builds the destination for a given link and description. */
  href: (url: string, text: string) => string
}

export const SHARE_TARGETS: ShareTarget[] = [
  {
    name: 'Bluesky',
    href: (url, text) =>
      `https://bsky.app/intent/compose?text=${encodeURIComponent(`${text} ${url}`)}`,
  },
  {
    name: 'Mastodon',
    href: (url, text) =>
      `https://mastodonshare.com/?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
  },
  {
    name: 'X',
    href: (url, text) =>
      `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
  },
  {
    name: 'Reddit',
    href: (url, text) =>
      `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(text)}`,
  },
  {
    name: 'Email',
    href: (url, text) =>
      `mailto:?subject=${encodeURIComponent(text)}&body=${encodeURIComponent(url)}`,
  },
]

/** True when the browser can hand off to the operating system's own sheet. */
export const canShareNatively = (): boolean => typeof navigator.share === 'function'

export async function shareNatively(url: string, title: string, text: string): Promise<boolean> {
  try {
    await navigator.share({ title, text, url })
    return true
  } catch {
    // A cancelled sheet is not a failure worth reporting.
    return false
  }
}
