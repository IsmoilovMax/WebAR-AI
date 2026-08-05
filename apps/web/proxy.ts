import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "acs_session";

const PUBLIC_PATHS = ["/login", "/api/health"];

/**
 * Optimistik autentifikatsiya filtri.
 *
 * Bu yerda faqat cookie BORLIGI tekshiriladi, uning haqiqiyligi emas:
 * proxy bazaga murojaat qilmasligi kerak (Next.js hujjatlari ham buni
 * tavsiya qilmaydi). Haqiqiy tekshiruv har bir sahifa va route handler
 * ichida requireSession / apiSession orqali bajariladi.
 *
 * Ya'ni bu qatlam xavfsizlik chegarasi emas - u shunchaki tizimga
 * kirmagan foydalanuvchini bo'sh sahifaga tushirmaydi.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  if (request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Avtorizatsiya talab qilinadi" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  // Kirgandan keyin foydalanuvchi so'ragan sahifaga qaytariladi.
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Statik fayllar, rasm optimizatsiyasi va demo sahifasidan tashqari hamma joyda.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|demo|models).*)",
  ],
};
