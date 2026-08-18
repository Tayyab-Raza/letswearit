import { PrismaClient, Prisma } from "@prisma/client";

const prisma = global.prismaGlobal ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") global.prismaGlobal = prisma;

// TEMP DIAGNOSTIC — remove after debugging
try {
  const sessionModel = Prisma.dmmf.datamodel.models.find(
    (m) => m.name === "Session",
  );
  console.log(
    "[DIAG] db.server.js loaded. Session fields:",
    sessionModel ? sessionModel.fields.map((f) => f.name) : "MODEL NOT FOUND",
  );
} catch (e) {
  console.log("[DIAG] Could not read DMMF:", e.message);
}

export default prisma;
