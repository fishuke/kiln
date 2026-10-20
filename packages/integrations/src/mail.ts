import { randomBytes } from "node:crypto";
import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";

export type MailMessage = { to: string; subject: string; text: string };

/** Sends email. SMTP in production, a Fake in tests. */
export interface Mailer {
  readonly name: string;
  send(message: MailMessage): Promise<void>;
}

export class FakeMailer implements Mailer {
  readonly name = "fake";
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage) {
    this.sent.push(message);
  }
}

export type SmtpOptions = {
  host: string;
  port: number;
  /** Implicit TLS (smtps://, port 465). Otherwise STARTTLS is used when the server offers it. */
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
  /** Hostname announced in EHLO. */
  hello?: string;
  /** Allow self-signed certificates (tests, internal relays). */
  allowInvalidCerts?: boolean;
  timeoutMs?: number;
};

/**
 * `smtp://user:pass@host:587?from=kiln@acme.test` or `smtps://…:465`. `from` defaults to
 * kiln@<host>.
 */
export function parseSmtpUrl(url: string, from?: string): SmtpOptions {
  const u = new URL(url);
  if (u.protocol !== "smtp:" && u.protocol !== "smtps:") throw new Error("KILN_SMTP_URL must start with smtp:// or smtps://");
  const secure = u.protocol === "smtps:";
  return {
    host: u.hostname,
    port: Number(u.port || (secure ? 465 : 587)),
    secure,
    user: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    from: from ?? u.searchParams.get("from") ?? `kiln@${u.hostname}`,
    allowInvalidCerts: u.searchParams.get("insecure") === "1",
  };
}

/** A minimal SMTP client (EHLO, STARTTLS, AUTH PLAIN, MAIL, RCPT, DATA) with no dependencies. */
export class SmtpMailer implements Mailer {
  readonly name = "smtp";
  constructor(private readonly o: SmtpOptions) {}

  async send(message: MailMessage): Promise<void> {
    if (/[\r\n]/.test(message.to + message.subject)) throw new Error("mail headers cannot contain line breaks");
    let socket: Socket | TLSSocket = await this.open();
    let reader = new ReplyReader(socket);
    const timeout = setTimeout(() => socket.destroy(new Error("SMTP timed out")), this.o.timeoutMs ?? 20_000);
    const cmd = async (line: string, expect: number[]) => {
      socket.write(`${line}\r\n`);
      return reader.expect(expect, line.startsWith("AUTH") ? "AUTH" : line);
    };
    try {
      await reader.expect([220], "greeting");
      const hello = this.o.hello ?? "kiln.local";
      let ehlo = await cmd(`EHLO ${hello}`, [250]);
      if (!this.o.secure && /\bSTARTTLS\b/i.test(ehlo)) {
        await cmd("STARTTLS", [220]);
        reader.detach();
        socket = await new Promise<TLSSocket>((resolve, reject) => {
          const s = tlsConnect({ socket, servername: this.o.host, rejectUnauthorized: !this.o.allowInvalidCerts }, () => resolve(s));
          s.once("error", reject);
        });
        reader = new ReplyReader(socket);
        ehlo = await cmd(`EHLO ${hello}`, [250]);
      }
      if (this.o.user) {
        const token = Buffer.from(`\u0000${this.o.user}\u0000${this.o.password ?? ""}`).toString("base64");
        await cmd(`AUTH PLAIN ${token}`, [235]);
      }
      await cmd(`MAIL FROM:<${this.o.from}>`, [250]);
      await cmd(`RCPT TO:<${message.to}>`, [250, 251]);
      await cmd("DATA", [354]);
      const headers = [
        `From: Kiln <${this.o.from}>`,
        `To: <${message.to}>`,
        `Subject: ${encodeHeader(message.subject)}`,
        `Date: ${new Date().toUTCString()}`,
        `Message-ID: <${randomBytes(12).toString("hex")}@${this.o.from.split("@")[1] ?? "kiln.local"}>`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: 8bit",
      ];
      const body = message.text.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
      socket.write(`${headers.join("\r\n")}\r\n\r\n${body}\r\n.\r\n`);
      await reader.expect([250], "message");
      socket.write("QUIT\r\n");
      await reader.expect([221], "QUIT").catch(() => {});
    } finally {
      clearTimeout(timeout);
      socket.end();
    }
  }

  private open(): Promise<Socket | TLSSocket> {
    return new Promise((resolve, reject) => {
      const s = this.o.secure
        ? tlsConnect({ host: this.o.host, port: this.o.port, servername: this.o.host, rejectUnauthorized: !this.o.allowInvalidCerts }, () => resolve(s))
        : netConnect({ host: this.o.host, port: this.o.port }, () => resolve(s));
      s.once("error", reject);
    });
  }
}

function encodeHeader(s: string) {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`;
}

/** Collects SMTP replies (multi-line "250-…" until "250 …"). */
class ReplyReader {
  private buf = "";
  private replies: string[] = [];
  private waiters: ((r: string) => void)[] = [];
  private failed?: Error;
  private readonly onData = (d: Buffer) => {
    this.buf += d.toString("utf8");
    let i: number;
    let current = "";
    while ((i = this.buf.indexOf("\r\n")) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      current += `${line}\n`;
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        this.push(this.pending + current);
        this.pending = "";
        current = "";
      }
    }
    this.pending += current;
  };
  private pending = "";
  private readonly onError = (e: Error) => {
    this.failed = e;
    for (const w of this.waiters.splice(0)) w("");
  };

  constructor(private readonly socket: Socket) {
    socket.on("data", this.onData);
    socket.on("error", this.onError);
  }

  detach() {
    this.socket.off("data", this.onData);
    this.socket.off("error", this.onError);
  }

  private push(r: string) {
    const w = this.waiters.shift();
    if (w) w(r);
    else this.replies.push(r);
  }

  private next(): Promise<string> {
    const r = this.replies.shift();
    if (r !== undefined) return Promise.resolve(r);
    if (this.failed) return Promise.reject(this.failed);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  async expect(codes: number[], what: string): Promise<string> {
    const r = await this.next();
    if (this.failed) throw new Error(`SMTP ${what} failed: ${this.failed.message}`);
    const code = Number(r.slice(0, 3));
    if (!codes.includes(code)) throw new Error(`SMTP ${what} failed: ${r.trim()}`);
    return r;
  }
}
