// Saves text as a file from the browser: an object URL and a click on a temporary link.
// The URL is revoked a moment later, not at once: revoking right after the click can
// cancel the download in some browsers. The default type is application/octet-stream:
// with text/plain, Chrome appends ".txt" to a name without an extension (Dockerfile ->
// Dockerfile.txt). No imports, so `node --test` loads downloadName directly.
export const REVOKE_OBJECT_URL_AFTER_MS = 1500;

// A browser does not accept a path in a download name: ".github/workflows/ci.yml" -> "ci.yml"
export const downloadName = (name: string): string => name.split('/').filter(Boolean).pop() || name;

export function downloadTextFile(name: string, content: string, type = 'application/octet-stream'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = downloadName(name);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_OBJECT_URL_AFTER_MS);
}
