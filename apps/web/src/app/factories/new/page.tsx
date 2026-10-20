import { connectRepo } from "@/app/actions";
import { SubmitButton } from "@/components/kiln/submit-button";
import { Page, PageHeader, Pre, Section } from "@/components/kiln/ui";

export default function NewFactory() {
  return (
    <>
      <PageHeader crumbs={[{ label: "Factories" }, { label: "Create factory" }]} />
      <Page narrow>
        <h1 className="mb-2 text-2xl font-semibold">Create a factory</h1>
        <p className="mb-8 text-sm text-muted-foreground">One factory per product. A factory is a definition tree rooted at factory.yaml: agents, automations, runners, scorers, skills and optional pipelines. Keep it in a GitHub repo you own so changes go through review.</p>
        <Section title="1. Start from a template" description="Scaffold a tree locally and push it to a new repo, e.g. acme/web-factory.">
          <Pre>{`pnpm kiln init web-factory --template sdlc     # or single-repo, po-feature, incident
cd web-factory && pnpm kiln validate .
git init && git add -A && git commit -m "Factory definition" && gh repo create acme/web-factory --private --source . --push`}</Pre>
        </Section>
        <Section title="2. Connect the config repo" description="Kiln validates it, applies it, and applies every later merge to its default branch. Warp-exported repos (schemaVersion v1alpha1) are converted automatically.">
          <form action={connectRepo} className="space-y-2">
            <div className="flex gap-2">
              <input name="repo" required placeholder="owner/repo, e.g. fishuke/kiln-config" className="h-9 flex-1 rounded-md border bg-background px-3 text-sm" />
              <input name="ref" placeholder="main" className="h-9 w-28 rounded-md border bg-background px-3 text-sm" />
              <input name="dir" placeholder="folder (optional)" className="h-9 w-40 rounded-md border bg-background px-3 text-sm" />
            </div>
            <SubmitButton>Connect and apply</SubmitButton>
          </form>
        </Section>
        <Section title="Or apply without a repo">
          <Pre>{`KILN_URL=http://localhost:4000 KILN_TOKEN=... pnpm kiln apply web-factory`}</Pre>
        </Section>
      </Page>
    </>
  );
}
