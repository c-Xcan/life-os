import { NextResponse, type NextRequest } from "next/server";

/**
 * 桌面版的访问令牌：本地服务能读写全部日记和 API Key，
 * 只允许带着桌面窗口令牌 Cookie 的请求访问，电脑上其他程序 / 网页访问这个端口一律拒绝。
 * 网页版（没有设置 LIFEOS_TOKEN）不受影响。
 */
export function proxy(req: NextRequest) {
  const token = process.env.LIFEOS_TOKEN;
  if (!token) return NextResponse.next();
  if (req.cookies.get("lifeos_token")?.value === token) return NextResponse.next();
  return new NextResponse("Forbidden", { status: 401 });
}

// public 里的公开图片不校验：next/image 在服务内部拉原图时不带 Cookie
export const config = {
  matcher: ["/((?!_next/static/|images/|logo\\.png$).*)"],
};
