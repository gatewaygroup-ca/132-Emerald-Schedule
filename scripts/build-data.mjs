// Bundles the current schedules into lib/projects.generated.json so the deployed
// site can read them without filesystem access. Runs before dev/build.
import { promises as fs } from "fs";
import { readProjectsDir } from "../lib/projectFiles.mjs";

const projects = (await readProjectsDir()) ?? [];
await fs.writeFile("lib/projects.generated.json", JSON.stringify(projects, null, 2) + "\n");
console.log(`Schedules bundled: ${projects.map((p) => p.slug).join(", ") || "(none)"}`);
