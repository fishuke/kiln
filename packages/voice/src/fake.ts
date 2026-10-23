import { VoiceError, type CreateVoiceSession, type CreatedVoiceSession, type VoiceCommand, type VoiceEvent, type VoiceLink, type VoiceProvider } from "./types";

/** A sideband a test drives: `emit` plays GPT-Live, `commands` holds what Kiln sent. */
export class FakeVoiceLink implements VoiceLink {
  readonly commands: VoiceCommand[] = [];
  detached = false;
  private readonly listeners = new Set<(event: VoiceEvent) => void>();

  on(listener: (event: VoiceEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  send(command: VoiceCommand) {
    if (this.detached) throw new VoiceError("closed", "The voice sideband is closed.");
    this.commands.push(command);
  }

  detach() {
    this.detached = true;
    this.listeners.clear();
  }

  emit(event: VoiceEvent) {
    for (const l of [...this.listeners]) l(event);
  }
}

export class FakeVoiceProvider implements VoiceProvider {
  readonly created: CreateVoiceSession[] = [];
  readonly attached: { sessionId: string; apiKey: string }[] = [];
  private readonly links = new Map<string, FakeVoiceLink>();

  async create(input: CreateVoiceSession): Promise<CreatedVoiceSession> {
    this.created.push(input);
    const sessionId = `live_${this.created.length}`;
    this.links.set(sessionId, new FakeVoiceLink());
    return { sessionId, sdp: `answer:${input.sdp}` };
  }

  async attach(sessionId: string, apiKey: string): Promise<VoiceLink> {
    const link = this.links.get(sessionId);
    if (!link) throw new VoiceError("not_found", `No live session ${sessionId}.`);
    this.attached.push({ sessionId, apiKey });
    return link;
  }

  /** The link of a created session, for a test to emit on and inspect. */
  link(sessionId: string): FakeVoiceLink {
    const link = this.links.get(sessionId);
    if (!link) throw new VoiceError("not_found", `No live session ${sessionId}.`);
    return link;
  }
}
