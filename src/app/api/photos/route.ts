import { handler, body } from "@/lib/api";
import { listPhotos, createAlbum, renameAlbum, deleteAlbum, setAlbumMembership, setCaption, deletePhotos } from "@/lib/photos/library";

export const dynamic = "force-dynamic";

export const GET = handler(() => listPhotos());

/**
 * { action: "createAlbum", name }
 * { action: "renameAlbum", id, name }
 * { action: "deleteAlbum", id }
 * { action: "addToAlbum" | "removeFromAlbum", paths, album }
 * { action: "caption", path, caption }
 * { action: "delete", paths }
 */
export const POST = handler(async (req: Request) => {
  const b = await body<{ action: string; name?: string; id?: string; paths?: string[]; album?: string; path?: string; caption?: string }>(req);
  switch (b.action) {
    case "createAlbum": return { album: createAlbum(b.name ?? "") };
    case "renameAlbum": renameAlbum(b.id ?? "", b.name ?? ""); return { ok: true };
    case "deleteAlbum": deleteAlbum(b.id ?? ""); return { ok: true };
    case "addToAlbum": setAlbumMembership(b.paths ?? [], b.album ?? "", true); return { ok: true };
    case "removeFromAlbum": setAlbumMembership(b.paths ?? [], b.album ?? "", false); return { ok: true };
    case "caption": setCaption(b.path ?? "", b.caption ?? ""); return { ok: true };
    case "delete": deletePhotos(b.paths ?? []); return { ok: true };
    default: throw new Error("未知操作");
  }
});
