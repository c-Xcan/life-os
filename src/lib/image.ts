"use client";

/** 浏览器端把图片压缩成 WebP：长边最多 maxSide 像素，按 EXIF 方向摆正 */
export async function compressToWebp(file: File, maxSide = 2048, quality = 0.82): Promise<Blob> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(/heic|heif/i.test(file.type + file.name) ? "浏览器无法读取 HEIC 格式，请先转成 JPG 再上传" : `无法读取图片：${file.name}`);
  }
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持图片处理");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", quality));
  if (!blob || blob.type !== "image/webp") throw new Error("当前浏览器不支持导出 WebP，请用 Chrome 或 Edge");
  return blob;
}

/** vault 里的附件路径 → 浏览器可访问的地址 */
export function attachmentUrl(src: string) {
  const clean = src.replace(/^(\.\.\/)+/, "").replace(/^\.\//, "").replace(/^\/+/, "");
  return clean.startsWith("attachments/") ? `/api/attachments?path=${encodeURIComponent(clean)}` : src;
}

export interface ExifInfo { takenAt?: string; lat?: number; lng?: number }

/**
 * 读取 JPEG 的 EXIF：拍摄时间和 GPS 位置（压缩成 WebP 前读取，否则会丢失）。
 * 只解析需要的几个字段；不是 JPEG 或没有 EXIF 时返回空对象。
 */
export async function readExif(file: File): Promise<ExifInfo> {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return {};
    let off = 2;
    while (off + 4 <= v.byteLength) {
      const marker = v.getUint16(off);
      const len = v.getUint16(off + 2);
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10); // "Exif"
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
      off += 2 + len;
    }
  } catch { /* 忽略损坏的 EXIF */ }
  return {};
}

function parseTiff(v: DataView, start: number): ExifInfo {
  const le = v.getUint16(start) === 0x4949;
  const u16 = (o: number) => v.getUint16(start + o, le);
  const u32 = (o: number) => v.getUint32(start + o, le);
  const ascii = (o: number, n: number) => { let s = ""; for (let i = 0; i < n; i++) { const c = v.getUint8(start + o + i); if (!c) break; s += String.fromCharCode(c); } return s; };
  const entries = (ifd: number) => {
    const out = new Map<number, { type: number; count: number; valOff: number }>();
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      out.set(u16(e), { type: u16(e + 2), count: u32(e + 4), valOff: e + 8 });
    }
    return out;
  };
  const str = (e?: { count: number; valOff: number }) => (e ? ascii(e.count > 4 ? u32(e.valOff) : e.valOff, e.count) : "");
  const rationals = (e?: { valOff: number; count: number }) => {
    if (!e) return null;
    const p = u32(e.valOff);
    return Array.from({ length: e.count }, (_, i) => { const d = u32(p + i * 8 + 4); return d ? u32(p + i * 8) / d : 0; });
  };

  const info: ExifInfo = {};
  const ifd0 = entries(u32(4));
  const exifPtr = ifd0.get(0x8769);
  const dt = exifPtr ? str(entries(u32(exifPtr.valOff)).get(0x9003)) : "";
  const when = dt || str(ifd0.get(0x0132));
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(when);
  if (m && m[1] !== "0000") info.takenAt = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;

  const gpsPtr = ifd0.get(0x8825);
  if (gpsPtr) {
    const g = entries(u32(gpsPtr.valOff));
    const lat = rationals(g.get(2)), lng = rationals(g.get(4));
    const latRef = str(g.get(1)), lngRef = str(g.get(3));
    if (lat?.length === 3 && lng?.length === 3) {
      const toDeg = (d: number[]) => d[0] + d[1] / 60 + d[2] / 3600;
      const la = toDeg(lat) * (latRef === "S" ? -1 : 1);
      const ln = toDeg(lng) * (lngRef === "W" ? -1 : 1);
      if ((la || ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180) { info.lat = +la.toFixed(6); info.lng = +ln.toFixed(6); }
    }
  }
  return info;
}

/** 把 EXIF 附加到上传表单 */
export function appendExif(fd: FormData, exif: ExifInfo) {
  if (exif.takenAt) fd.append("takenAt", exif.takenAt);
  if (exif.lat !== undefined && exif.lng !== undefined) { fd.append("lat", String(exif.lat)); fd.append("lng", String(exif.lng)); }
}
