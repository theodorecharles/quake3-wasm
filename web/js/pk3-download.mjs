export const RANGE_BYTES = 16 * 1024 * 1024;

export async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function downloadRanges(asset, onProgress = () => {}, fetcher = fetch) {
  const result = new Uint8Array(asset.bytes);
  let loaded = 0;
  for (let start = 0; start < asset.bytes; start += RANGE_BYTES) {
    const end = Math.min(asset.bytes - 1, start + RANGE_BYTES - 1);
    const response = await fetcher(asset.url, { headers: { Range: `bytes=${start}-${end}` } });
    if (response.status !== 206) throw new Error(`expected HTTP 206 for ${asset.path}, got ${response.status}`);
    const chunk = new Uint8Array(await response.arrayBuffer());
    const expected = end - start + 1;
    if (chunk.byteLength !== expected) {
      throw new Error(`${asset.path} range ${start}-${end} was ${chunk.byteLength} bytes, expected ${expected}`);
    }
    result.set(chunk, start);
    loaded += chunk.byteLength;
    onProgress(loaded, asset.bytes);
  }
  if (result.byteLength !== asset.bytes) throw new Error(`${asset.path} has the wrong length`);
  const actualHash = await sha256(result);
  if (actualHash !== asset.sha256.toLowerCase()) {
    throw new Error(`${asset.path} failed SHA-256 validation`);
  }
  return result;
}
