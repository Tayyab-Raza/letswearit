import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const plans = [
  {
    key: "starter",
    name: "Starter",
    monthlyPrice: 9.99,
    generationLimit: 100,
    shopifyPlanHandle: "Starter",
    features: ["tryon", "size_fit"],
  },
  {
    key: "growth",
    name: "Growth",
    monthlyPrice: 29.99,
    generationLimit: 500,
    shopifyPlanHandle: "Growth",
    features: [
      "tryon",
      "size_fit",
      "multi_angle_spin",
      "full_outfit",
      "closet",
    ],
  },
  {
    key: "pro",
    name: "Pro",
    monthlyPrice: 79.99,
    generationLimit: 2000,
    shopifyPlanHandle: "Pro",
    features: [
      "tryon",
      "size_fit",
      "multi_angle_spin",
      "full_outfit",
      "closet",
      "video_tryon",
    ],
  },
];

for (const plan of plans) {
  await prisma.plan.upsert({ where: { key: plan.key }, update: plan, create: plan });
}
console.log("Plans seeded.");
await prisma.$disconnect();