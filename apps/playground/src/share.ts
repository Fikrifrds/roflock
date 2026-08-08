/**
 * Share links carry the source itself, not a reference to it.
 *
 * There is no server to store a snippet on, so a link is self-contained: the
 * workflow travels in the URL fragment, which browsers never send to a server.
 * A shared Roflock workflow is a code review artefact, and posting one should not
 * mean uploading it anywhere.
 */

const PREFIX = '#s=';

export function encodeShareLink(source: string, origin = ''): string {
  // `encodeURIComponent` then base64, so multi-byte characters survive `btoa`.
  const encoded = btoa(encodeURIComponent(source));
  return `${origin}${PREFIX}${encoded}`;
}

export function decodeShareLink(hash: string): string | undefined {
  if (!hash.startsWith(PREFIX)) return undefined;
  try {
    const decoded = decodeURIComponent(atob(hash.slice(PREFIX.length)));
    // An empty payload is not a workflow; treating it as one would silently
    // replace whatever the visitor was editing with nothing.
    return decoded.trim() === '' ? undefined : decoded;
  } catch {
    return undefined;
  }
}
