import Link from "next/link";

export function DashboardProjectSwitcher({
  projects,
  selectedProjectId,
  path,
}: {
  projects: readonly { project: { id: string; name: string | null; url: string } }[];
  selectedProjectId: string;
  path: string;
}) {
  if (projects.length < 2) return null;
  return (
    <nav className="dashboard-project-switcher" aria-label="Select project">
      {projects.map(({ project }) => (
        <Link
          key={project.id}
          href={`${path}?project=${encodeURIComponent(project.id)}`}
          data-selected={project.id === selectedProjectId}
        >
          {project.name ?? new URL(project.url).hostname}
        </Link>
      ))}
    </nav>
  );
}
