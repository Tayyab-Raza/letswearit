import { Prisma } from "@prisma/client";

const sessionModel = Prisma.dmmf.datamodel.models.find(
  (m) => m.name === "Session",
);

if (!sessionModel) {
  console.log("❌ No Session model found in the generated client at all.");
} else {
  console.log("✅ Session model found. Fields:");
  for (const field of sessionModel.fields) {
    console.log(
      `  - ${field.name}${field.isId ? " (ID)" : ""} : ${field.type}`,
    );
  }
}
