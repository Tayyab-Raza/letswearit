import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const plans = [
  { key: "starter", name: "Starter", monthlyPrice: 9.99, generationLimit: 100, shopifyPlanHandle: "Starter" },
  { key: "growth", name: "Growth", monthlyPrice: 29.99, generationLimit: 500, shopifyPlanHandle: "Growth" },
  { key: "pro", name: "Pro", monthlyPrice: 79.99, generationLimit: 2000, shopifyPlanHandle: "Pro" },
];

for (const plan of plans) {
  await prisma.plan.upsert({ where: { key: plan.key }, update: plan, create: plan });
}
console.log("Plans seeded.");
await prisma.$disconnect();