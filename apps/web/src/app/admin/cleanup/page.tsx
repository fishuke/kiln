import type { Metadata } from "next";
import { KilnApiError } from "@kiln/sdk-ts";
import { ApiDown, Empty, Page, PageHeader, Section } from "@/components/kiln/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { bytes, timeAgo } from "@/lib/format";
import { api, errorMessage } from "@/lib/kiln";
import { CleanupControls } from "./controls";

export const metadata: Metadata = { title: "Clean up" };

/** The Docker clean-up's dry run: what it would remove, before anyone removes anything. */
export default async function Cleanup() {
  let status;
  try {
    status = await api.cleanup();
  } catch (err) {
    if (err instanceof KilnApiError && err.status === 403)
      return (
        <Page narrow>
          <Empty title="Server admins only">Add your email to KILN_ADMIN_EMAILS on the server to see this page.</Empty>
        </Page>
      );
    return <ApiDown error={errorMessage(err)} />;
  }
  const crumbs = [{ label: "Server", href: "/admin" }, { label: "Clean up" }];
  if (status.available && !status.plan)
    return (
      <>
        <PageHeader crumbs={crumbs} />
        <Page narrow>
          <Empty title="Docker did not answer">{status.error}</Empty>
        </Page>
      </>
    );
  if (!status.available || !status.plan || !status.usage)
    return (
      <>
        <PageHeader crumbs={crumbs} />
        <Page narrow>
          <Empty title="Nothing to clean up here">Clean-up works on Docker hosts: run the API with KILN_SANDBOX=docker.</Empty>
        </Page>
      </>
    );
  const { plan, usage, lastRun } = status;
  const items = [...plan.containers.map((c) => ({ ...c, kind: "Container" })), ...plan.images.map((i) => ({ ...i, kind: "Image" }))];
  const imageBytes = plan.images.reduce((n, i) => n + (i.sizeBytes ?? 0), 0);
  const now = Date.now();
  return (
    <>
      <PageHeader crumbs={crumbs} />
      <Page>
        {status.error && <p className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">{status.error}</p>}
        {usage.length > 0 && (
          <Section title="Docker disk" description="Everything on this Docker host, not only Kiln's.">
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Type</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Size</TableHead>
                    <TableHead className="pr-4 text-right">Reclaimable</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usage.map((u) => (
                    <TableRow key={u.type}>
                      <TableCell className="pl-4">{u.type}</TableCell>
                      <TableCell className="text-right tabular-nums">{u.count}</TableCell>
                      <TableCell className="text-right tabular-nums">{bytes(u.sizeBytes)}</TableCell>
                      <TableCell className="pr-4 text-right tabular-nums">{bytes(u.reclaimableBytes)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Section>
        )}

        <Section
          title="What clean-up removes"
          description={`Kiln's own things only${plan.project ? ` (Compose project ${plan.project})` : ""}: stopped containers older than a day, images a newer build replaced (the newest 2 per image stay, never one in use), and build cache older than ${Math.round(plan.buildCache.olderThanHours / 24)} days down to ${bytes(plan.buildCache.keepBytes)}.`}
          action={<CleanupControls scheduled={status.scheduled} hasRun={Boolean(lastRun)} empty={items.length === 0} />}
        >
          {items.length === 0 ? (
            <Empty title="No Kiln containers or images to remove">
              Only build cache older than {Math.round(plan.buildCache.olderThanHours / 24)} days would go.
            </Empty>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Name</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Why</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="pr-4 text-right">Size</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="max-w-80 truncate pl-4 font-mono text-xs">{i.name}</TableCell>
                      <TableCell>{i.kind}</TableCell>
                      <TableCell className="text-muted-foreground">{i.reason}</TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">{timeAgo(i.createdAt, now)}</TableCell>
                      <TableCell className="pr-4 text-right tabular-nums">{i.sizeBytes === undefined ? "" : bytes(i.sizeBytes)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {imageBytes > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">Images add up to {bytes(imageBytes)}; shared layers make the space actually freed smaller.</p>
          )}
        </Section>

        <Section
          title="Kept: data volumes"
          description="Clean-up never removes a volume. A volume no container uses may belong to a deleted Kiln; remove it by hand once you are sure."
        >
          <ul className="space-y-1 text-sm">
            {plan.volumes.length === 0 && <li className="text-muted-foreground">No kiln-data volumes.</li>}
            {plan.volumes.map((v) => (
              <li key={v.name} className="flex gap-2">
                <code className="font-mono text-xs">{v.name}</code>
                <span className={v.inUse ? "text-emerald-600" : "text-amber-600"}>{v.inUse ? "in use" : "no container uses it"}</span>
              </li>
            ))}
          </ul>
        </Section>

        {lastRun && (
          <Section title="Last clean-up" description={`${timeAgo(lastRun.at, now)} by ${lastRun.by}`}>
            <p className="text-sm">
              Removed {lastRun.removed.containers.length} container(s) and {lastRun.removed.images.length} image(s); Docker uses {bytes(lastRun.reclaimedBytes)}{" "}
              less.
              {lastRun.failed.length > 0 && <span className="text-amber-600"> Could not remove: {lastRun.failed.join(", ")}.</span>}
            </p>
          </Section>
        )}
      </Page>
    </>
  );
}
