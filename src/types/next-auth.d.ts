import "next-auth";
import "next-auth/jwt";

type AppRole = "admin" | "subscriber";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: AppRole;
      subscriberId?: string;
    };
  }
  interface User {
    role?: AppRole;
    subscriberId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: AppRole;
    subscriberId?: string;
  }
}
