// Upload utilities — replaces src/utils/uploads.js
// Uses R2 for file storage instead of local filesystem

export const MAX_FILE_SIZE = 8 * 1024 * 1024;

function getContentType(file) {
  if (!file || file.length < 4) return 'image/jpeg';
  if (file[0] === 0x52 && file[1] === 0x49 && file[2] === 0x46 && file[3] === 0x46) return 'image/webp';
  if (file[0] === 0xFF && file[1] === 0xD8 && file[2] === 0xFF) return 'image/jpeg';
  if (file[0] === 0x89 && file[1] === 0x50 && file[2] === 0x4E && file[3] === 0x47) return 'image/png';
  return 'image/jpeg';
}

function getFileExtension(contentType) {
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/png') return 'png';
  return 'jpg';
}

export async function savePhoto(env, id, buffer) {
  const contentType = getContentType(buffer);
  const ext = getFileExtension(contentType);
  const key = `${id}.${ext}`;
  await env.BUCKETS.put(key, buffer, { httpMetadata: { contentType } });
  return key;
}

export async function deletePhoto(env, id) {
  const extensions = ['webp', 'jpg', 'png'];
  for (const ext of extensions) {
    try { await env.BUCKETS.delete(`${id}.${ext}`); } catch { }
  }
}

export async function getPhoto(env, id) {
  const extensions = ['webp', 'jpg', 'png'];
  for (const ext of extensions) {
    const obj = await env.BUCKETS.get(`${id}.${ext}`);
    if (obj) return obj;
  }
  return null;
}

export function deviceInfoFromReq(c) {
  return (c.req.header('x-device-info') || c.req.header('user-agent') || '').slice(0, 300);
}

export async function parseMultipart(c) {
  const formData = await c.req.formData();
  const file = formData.get('photo');
  const body = {};
  for (const [key, value] of formData.entries()) {
    if (key !== 'photo' && typeof value === 'string') { body[key] = value; }
  }
  let fileBuffer = null;
  if (file && file instanceof File) {
    const arrayBuffer = await file.arrayBuffer();
    fileBuffer = new Uint8Array(arrayBuffer);
  }
  return { body, file: fileBuffer };
}

export async function servePhotoInline(c, id) {
  const obj = await getPhoto(c.env, id);
  if (!obj) return c.notFound();
  const contentType = obj.httpMetadata?.contentType || 'image/jpeg';
  return new Response(obj.body, { headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400' } });
}

export async function servePhotoDownload(c, id, filename) {
  const obj = await getPhoto(c.env, id);
  if (!obj) return c.notFound();
  const contentType = obj.httpMetadata?.contentType || 'image/jpeg';
  const ext = contentType === 'image/webp' ? 'webp' : contentType === 'image/png' ? 'png' : 'jpg';
  const downloadName = filename ? `${filename}.${ext}` : `photo_${id}.${ext}`;
  return new Response(obj.body, { headers: { 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${downloadName}"`, 'Cache-Control': 'no-cache' } });
}
