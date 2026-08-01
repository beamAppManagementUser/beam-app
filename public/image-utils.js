// Client-side image processing utility
const MAX_WIDTH = 1000;
const QUALITY = 0.80;

export async function processImage(file) {
  if (!file || !file.type.startsWith('image/')) return file;
  const img = new Image();
  const url = URL.createObjectURL(file);
  try {
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
    let width = img.naturalWidth;
    let height = img.naturalHeight;
    if (width > MAX_WIDTH) { height = Math.round((height * MAX_WIDTH) / width); width = MAX_WIDTH; }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise((resolve) => { canvas.toBlob(resolve, 'image/jpeg', QUALITY); });
    if (!blob) return file;
    const originalName = file.name.replace(/\.[^.]+$/, '');
    const newFileName = `${originalName}.jpg`;
    return new File([blob], newFileName, { type: 'image/jpeg' });
  } catch (e) {
    console.error('Image processing failed:', e);
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function processImageFromInput(input) {
  if (!input.files || !input.files[0]) return null;
  return await processImage(input.files[0]);
}
