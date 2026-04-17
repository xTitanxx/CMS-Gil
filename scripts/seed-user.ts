import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

function createPrisma() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
  });
  return new PrismaClient({ adapter });
}

const prisma = createPrisma();

async function main() {
  const email = "anavollmer4@gmail.com";
  const password = "1234";
  const name = "Ana";

  const hash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: hash, name },
    create: { email, name, passwordHash: hash },
  });

  console.log(`Seeded user: ${user.email} (id: ${user.id})`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
