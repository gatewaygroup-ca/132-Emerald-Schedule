import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import ScheduleEditor from "@/components/admin/ScheduleEditor";
import { isAdmin } from "@/lib/auth";
import { getProject } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit Schedule" };

export default async function EditPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!(await isAdmin())) redirect("/admin");
  const project = await getProject((await params).slug);
  if (!project) notFound();
  return <ScheduleEditor initial={project} />;
}
