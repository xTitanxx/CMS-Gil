import { prisma } from "../src/lib/prisma";
(async () => {
  const p = await prisma.post.findUnique({ where: { id: "cmnpbb4qb01fogvsbh9rfuorn" }, include: { media: true } });
  console.log(JSON.stringify(p, null, 2));
  await prisma.$disconnect();
})();
