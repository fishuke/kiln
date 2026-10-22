import { ArrowRight, Layers, MessageSquare, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const steps = [
  { icon: MessageSquare, title: "Describe it", text: "Tell the agent what to build in the chat." },
  { icon: Sparkles, title: "Watch it change", text: "Every turn updates this preview within seconds." },
  { icon: Layers, title: "Keep what works", text: "Each change is a version you can restore." },
];

export default function Home() {
  return (
    <main className="min-h-dvh bg-gradient-to-b from-background to-muted/60">
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-12 px-6 py-24 text-center">
        <div className="flex flex-col items-center gap-5">
          <Badge variant="secondary">New app</Badge>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">Your app starts here</h1>
          <p className="max-w-xl text-lg text-pretty text-muted-foreground">
            Ask for a page, a form or a whole feature. This screen is a placeholder; the first change replaces it.
          </p>
          <Button size="lg">
            Start building
            <ArrowRight />
          </Button>
        </div>
        <div className="grid w-full gap-4 sm:grid-cols-3">
          {steps.map(({ icon: Icon, title, text }) => (
            <Card key={title} className="text-left">
              <CardHeader>
                <Icon className="size-5 text-muted-foreground" />
                <CardTitle>{title}</CardTitle>
                <CardDescription>{text}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}
