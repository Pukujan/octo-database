import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { PageHeader } from "@v2/components/page-header";
import { EmptyState } from "@v2/components/feedback";
import { Button } from "@v2/components/ui/button";

export default function NotFoundPage() {
  return (
    <>
      <PageHeader title="Not found" description="That view does not exist in this workspace portal." />
      <EmptyState
        icon={Compass}
        title="404 — no such view"
        description="The address does not match Overview, Storage, Files, Gallery, Operations, Access, or Fleet."
        action={
          <Button asChild size="sm">
            <Link to="/">Back to Overview</Link>
          </Button>
        }
      />
    </>
  );
}
