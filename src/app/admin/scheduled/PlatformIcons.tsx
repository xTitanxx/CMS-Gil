import type { ComponentType, SVGProps } from "react";
import { SiInstagram, SiYoutube, SiTiktok, SiFacebook } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

const ICONS: Record<string, IconComponent> = {
  INSTAGRAM: SiInstagram as unknown as IconComponent,
  LINKEDIN: FaLinkedin as unknown as IconComponent,
  YOUTUBE: SiYoutube as unknown as IconComponent,
  TIKTOK: SiTiktok as unknown as IconComponent,
  FACEBOOK: SiFacebook as unknown as IconComponent,
  FACEBOOK_PAGE: SiFacebook as unknown as IconComponent,
};

const COLORS: Record<string, string> = {
  INSTAGRAM: "text-pink-600",
  LINKEDIN: "text-blue-700",
  YOUTUBE: "text-red-600",
  TIKTOK: "text-gray-900",
  FACEBOOK: "text-blue-600",
  FACEBOOK_PAGE: "text-blue-600",
};

interface Props {
  platforms: string[];
  size?: number;
  className?: string;
}

export function PlatformIcons({ platforms, size = 14, className = "" }: Props) {
  if (platforms.length === 0) return null;
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {platforms.map((p) => {
        const Icon = ICONS[p];
        if (!Icon) return null;
        return (
          <Icon
            key={p}
            size={size}
            aria-label={p}
            className={COLORS[p] ?? "text-gray-700"}
          />
        );
      })}
    </div>
  );
}
