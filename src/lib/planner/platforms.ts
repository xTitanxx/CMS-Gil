import type { ComponentType } from "react";
import { SiFacebook, SiInstagram, SiYoutube, SiTiktok } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";

export const PLATFORM_META: Record<
  string,
  { Icon: ComponentType<{ className?: string }>; color: string }
> = {
  INSTAGRAM: { Icon: SiInstagram, color: "text-[#E1306C]" },
  instagram: { Icon: SiInstagram, color: "text-[#E1306C]" },
  FACEBOOK_PAGE: { Icon: SiFacebook, color: "text-[#1877F2]" },
  facebook_page: { Icon: SiFacebook, color: "text-[#1877F2]" },
  FACEBOOK: { Icon: SiFacebook, color: "text-[#1877F2]" },
  facebook: { Icon: SiFacebook, color: "text-[#1877F2]" },
  LINKEDIN: { Icon: FaLinkedin, color: "text-[#0A66C2]" },
  linkedin: { Icon: FaLinkedin, color: "text-[#0A66C2]" },
  YOUTUBE: { Icon: SiYoutube, color: "text-[#FF0000]" },
  youtube: { Icon: SiYoutube, color: "text-[#FF0000]" },
  TIKTOK: { Icon: SiTiktok, color: "text-[#111111]" },
  tiktok: { Icon: SiTiktok, color: "text-[#111111]" },
};

function platformBrand(p: string): string {
  const u = p.toUpperCase();
  if (u === "FACEBOOK" || u === "FACEBOOK_PAGE") return "FACEBOOK";
  return u;
}

export function dedupePlatforms(platforms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of platforms) {
    const brand = platformBrand(p);
    if (seen.has(brand)) continue;
    seen.add(brand);
    out.push(p);
  }
  return out;
}
