import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ScheduleView from "@/components/ScheduleView";
import { getProject } from "@/lib/store";

// Always read the latest saved schedule.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const project = await getProject((await params).slug);
  return { title: project ? `Project Schedule – ${project.propertyAddress}` : "Project Schedule" };
}

export default async function ProjectPage({ params }: Params) {
  const project = await getProject((await params).slug);
  if (!project) notFound();

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-8 sm:py-14">
      <ScheduleView {...project} />
    </main>
  );
}
