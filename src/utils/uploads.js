// Upload utilities — replaces src/utils/uploads.js
// Stores photos in D1 (base64) instead of R2 — no payment method needed
// Hard limits enforced: 200KB per photo, 5,000 photos max, root admin toggle

const MAX_PHOTOS = 5000;
const DEFAULT_MAX_PHOTO_KB = 200;

function getContentType(file) {
  if (!file || file.length < 4) return 'image/jpeg';
  if (file[0] === 0x52 && file[1] === 0x49 && file[2] === 0x46 && file[3] === 0x46) return 'image/webp';
  if (file[0] === 0xFF && file[1] === 0xD8 && file[2] === 0xFF) return 'image/jpeg';
  if (file[0] === 0x89 && file[1] === 0x50 && file[2] === 0x4E && file[3] === 0x47) return 'image/png';
  return 'image/jpeg';
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function getSetting(env, key, defaultValue) {
  const row = await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first();
  return row ? row.value : defaultValue;
}

async function checkPhotoLimit(env) {
  const count = await env.DB.prepare('SELECT COUNT(*) AS c FROM photos').first();
  if (count.c >= MAX_PHOTOS) {
    throw new Error(`Photo limit reached (${MAX_PHOTOS}). Delete old photos or purge old records to free up space.`);
  }
  const enabled = await getSetting(env, 'photo_uploads_enabled', '1');
  if (enabled !== '1') {
    throw new Error('Photo uploads are currently disabled by the root admin.');
  }
}

export async function savePhoto(env, id, buffer) {
  await checkPhotoLimit(env);
  const contentType = getContentType(buffer);
  const maxKb = parseInt(await getSetting(env, 'max_photo_size_kb', String(DEFAULT_MAX_PHOTO_KB)), 10);
  const sizeKb = Math.ceil(buffer.length / 1024);
  if (sizeKb > maxKb) {
    throw new Error(`Photo is ${sizeKb}KB — exceeds the ${maxKb}KB limit. The app should compress it before uploading.`);
  }
  const base64 = arrayBufferToBase64(buffer);
  const now = new Date().toISOString();
  await env.DB.prepare('INSERT INTO photos (id, content_type, data, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, contentType, base64, now).run();
  return id;
}

export async function deletePhoto(env, id) {
  await env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(id).run();
}

export async function getPhoto(env, id) {
  const row = await env.DB.prepare('SELECT content_type, data FROM photos WHERE id = ?').bind(id).first();
  if (!row) return null;
  return { contentType: row.content_type, buffer: base64ToArrayBuffer(row.data) };
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
  const photo = await getPhoto(c.env, id);
  if (!photo) return c.notFound();
  return new Response(photo.buffer, {
    headers: { 'Content-Type': photo.contentType, 'Cache-Control': 'public, max-age=86400' }
  });
}

export async function servePhotoDownload(c, id, filename) {
  const photo = await getPhoto(c.env, id);
  if (!photo) return c.notFound();
  const ext = photo.contentType === 'image/webp' ? 'webp' : photo.contentType === 'image/png' ? 'png' : 'jpg';
  const downloadName = filename ? `${filename}.${ext}` : `photo_${id}.${ext}`;
  return new Response(photo.buffer, {
    headers: {
      'Content-Type': photo.contentType,
      'Content-Disposition': `attachment; filename="${downloadName}"`,
      'Cache-Control': 'no-cache',
    }
  });
}

export async function getPhotoCount(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM photos').first();
  return row?.c ?? 0;
}

export async function getPhotoSettings(env) {
  const enabled = await getSetting(env, 'photo_uploads_enabled', '1');
  const maxKb = await getSetting(env, 'max_photo_size_kb', String(DEFAULT_MAX_PHOTO_KB));
  const count = await getPhotoCount(env);
  return {
    enabled: enabled === '1',
    maxPhotoSizeKb: parseInt(maxKb, 10),
    photoCount: count,
    photoLimit: MAX_PHOTOS,
    remaining: MAX_PHOTOS - count,
  };
}
