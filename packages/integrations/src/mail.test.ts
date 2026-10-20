import { createServer, type Server } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseSmtpUrl, SmtpMailer } from "./mail";

/** A scripted SMTP server: records the conversation and the message data. */
function fakeSmtp() {
  const sessions: { lines: string[]; data: string }[] = [];
  const server: Server = createServer((sock) => {
    const s = { lines: [] as string[], data: "" };
    sessions.push(s);
    let inData = false;
    let buf = "";
    sock.write("220 fake ESMTP\r\n");
    sock.on("data", (d) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            sock.write("250 queued\r\n");
          } else s.data += `${line}\n`;
          continue;
        }
        s.lines.push(line);
        if (line.startsWith("EHLO")) sock.write("250-fake\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n");
        else if (line.startsWith("AUTH PLAIN")) sock.write(Buffer.from(line.slice(11), "base64").toString() === "\u0000kiln\u0000pw" ? "235 ok\r\n" : "535 bad\r\n");
        else if (line.startsWith("MAIL") || line.startsWith("RCPT")) sock.write("250 ok\r\n");
        else if (line === "DATA") {
          inData = true;
          sock.write("354 go\r\n");
        } else if (line === "QUIT") sock.end("221 bye\r\n");
      }
    });
  });
  return { server, sessions };
}

describe("SMTP mailer", () => {
  const smtp = fakeSmtp();
  let port = 0;
  beforeAll(async () => {
    await new Promise<void>((r) => smtp.server.listen(0, "127.0.0.1", r));
    port = (smtp.server.address() as { port: number }).port;
  });
  afterAll(() => new Promise<void>((r) => smtp.server.close(() => r())));

  it("parses KILN_SMTP_URL", () => {
    expect(parseSmtpUrl("smtps://me%40x.test:p%40ss@mail.x.test?from=kiln@x.test")).toMatchObject({ host: "mail.x.test", port: 465, secure: true, user: "me@x.test", password: "p@ss", from: "kiln@x.test" });
    expect(parseSmtpUrl("smtp://mail.x.test")).toMatchObject({ port: 587, secure: false, from: "kiln@mail.x.test" });
    expect(() => parseSmtpUrl("http://x")).toThrow("smtp://");
  });

  it("authenticates and sends a message with dot-stuffing", async () => {
    const mailer = new SmtpMailer({ ...parseSmtpUrl(`smtp://kiln:pw@127.0.0.1:${port}?from=kiln@acme.test`) });
    await mailer.send({ to: "po@acme.test", subject: "Spec ready: Saved carts", text: "Hello\n.leading dot\nBye" });
    const s = smtp.sessions.at(-1)!;
    expect(s.lines).toEqual(["EHLO kiln.local", expect.stringMatching(/^AUTH PLAIN /), "MAIL FROM:<kiln@acme.test>", "RCPT TO:<po@acme.test>", "DATA", "QUIT"]);
    expect(s.data).toContain("Subject: Spec ready: Saved carts");
    expect(s.data).toContain("\n..leading dot\n");
  });

  it("reports a rejected login", async () => {
    const mailer = new SmtpMailer(parseSmtpUrl(`smtp://kiln:wrong@127.0.0.1:${port}`));
    await expect(mailer.send({ to: "a@x.test", subject: "x", text: "y" })).rejects.toThrow("SMTP AUTH failed: 535 bad");
  });
});
