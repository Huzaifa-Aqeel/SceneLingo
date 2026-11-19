// The extension can only be added in Chrome-family browsers on a computer (Chrome, Edge, Brave, ...).
interface NavLike { userAgentData?: { mobile?: boolean; brands?: { brand: string }[] }; userAgent?: string }

export function canInstallExtension(nav: NavLike = navigator as NavLike): boolean {
  const data = nav.userAgentData;
  if (data) return !data.mobile && (data.brands ?? []).some((b) => /chromium/i.test(b.brand));
  const ua = nav.userAgent ?? "";
  return /Chrome\//.test(ua) && !/Mobile|Android|OPR\/|Firefox/.test(ua) ? true : false;
}

export const EXTENSION_ZIP = "/scenelingo-extension.zip";
