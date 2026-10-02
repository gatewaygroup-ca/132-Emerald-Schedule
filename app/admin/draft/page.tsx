import type { Metadata } from "next";
import { redirect } from "next/navigation";
import ScheduleEditor from "@/components/admin/ScheduleEditor";
import { isAdmin } from "@/lib/auth";
import { slugify } from "@/lib/project";
import { canWrite, getProject, githubNewFileUrl } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New Schedule" };

/** A new, not-yet-published project (used when the server cannot save directly). */
export default async function DraftPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!(await isAdmin()) || canWrite()) redirect("/admin");
  const q = await searchParams;
  const slug = slugify(q.slug || q.address || "");
  if (!slug || slug === "draft") redirect("/admin");
  if (await getProject(slug)) redirect(`/admin/${slug}`);

  return (
    <ScheduleEditor
      initial={{
        slug,
        propertyAddress: (q.address || "").slice(0, 200),
        projectName: (q.name || "").slice(0, 200),
        schedule: [],
        updatedAt: new Date().toISOString(),
      }}
      publish={{ newFileUrl: githubNewFileUrl() }}
      isNew
    />
  );
}
