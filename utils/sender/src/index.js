import { DurableObject } from "cloudflare:workers";

export class StreamRelay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.senderReader = null;
    this.receiverController = null;
    this.senderConnected = false;
    this.receiverConnected = false;
    this.senderResolve = null;
    this.timeoutId = null;
    this.channelCreated = false;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get("role");
    const timeout = url.searchParams.get("timeout");

    if (role === "sender") {
      return this.handleSender(request, timeout);
    } else if (role === "receiver") {
      return this.handleReceiver(request);
    }

    return new Response("Invalid role\n", { status: 400 });
  }

  async handleSender(request, timeout) {
    if (this.senderConnected) {
      return new Response("Sender already connected\n", { status: 409 });
    }
    this.channelCreated = true;
    this.senderConnected = true;
    this.senderReader = request.body.getReader();
    
    const timeoutMs = (parseInt(timeout) || 10) * 1000;

    try {
      if (this.receiverController) {
        this.clearTimeout();
        await this.pump();
      } else {
        const timeoutPromise = new Promise((_, reject) => {
          this.timeoutId = setTimeout(() => {
            reject(new Error(`Connection timeout: receiver not connected within ${timeoutMs / 1000} seconds`));
          }, timeoutMs);
        });

        await Promise.race([
          new Promise((resolve) => {
            this.senderResolve = resolve;
          }),
          timeoutPromise
        ]);

        this.clearTimeout();
        await this.pump();
      }

      return new Response("Transfer complete\n");
    } catch (e) {
      return new Response(`Error: ${e.message}\n`, { status: 408 });
    } finally {
      this.reset();
    }
  }

  async handleReceiver(request) {
    if (!this.channelCreated) {
      return new Response("Channel not found. Sender must connect first.\n", { status: 404 });
    }

    if (this.receiverConnected) {
      return new Response("Receiver already connected\n", { status: 409 });
    }
    this.receiverConnected = true;

    const stream = new ReadableStream({
      start: (controller) => {
        this.receiverController = controller;

        if (this.senderResolve) {
          this.clearTimeout();
          this.senderResolve();
        }
      },
      cancel: () => {
        this.reset();
      }
    });

    return new Response(stream, {
      headers: { "Content-Type": "application/octet-stream" }
    });
  }

  async pump() {
    try {
      while (true) {
        const { done, value } = await this.senderReader.read();
        if (done) {
          this.receiverController.close();
          break;
        }
        this.receiverController.enqueue(value);
      }
    } catch (e) {
      this.receiverController.error(e);
    }
  }

  clearTimeout() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  reset() {
    this.clearTimeout();
    this.senderReader = null;
    this.receiverController = null;
    this.senderConnected = false;
    this.receiverConnected = false;
    this.senderResolve = null;
    this.channelCreated = false;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const token = url.pathname.slice(1);

    if (!token || token === "") {
      const host = request.headers.get("host");
      const protocol = host?.includes("localhost") || host?.includes("127.0.0.1") ? "http" : "https";
      const timeout = env.TIMEOUT_SECONDS || "10";
      return new Response(
`P2P File Transfer

Send:    curl -X POST ${protocol}://${host}/<token> --data-binary @file
Receive: curl ${protocol}://${host}/<token> > file

Options:
  ?timeout=N  Seconds to wait for receiver (default: ${timeout}, max: 300)

Note: Receiver must connect within the timeout after sender initiates transfer.
`);
    }

    const id = env.RELAY.idFromName(token);
    const relay = env.RELAY.get(id);

    if (request.method === "POST") {
      const envDefault = parseInt(env.TIMEOUT_SECONDS) || 10;
      const requested = parseInt(url.searchParams.get("timeout")) || envDefault;
      const timeout = Math.min(requested, 300);
      return relay.fetch(new Request(`https://relay/?role=sender&timeout=${timeout}`, {
        method: "POST",
        body: request.body,
      }));
    }

    if (request.method === "GET") {
      return relay.fetch(new Request(`https://relay/?role=receiver`));
    }

    return new Response("Method not allowed\n", { status: 405 });
  }
};
