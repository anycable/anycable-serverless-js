[![npm version](https://badge.fury.io/js/@anycable%2Fserverless-js.svg)](https://badge.fury.io/js/@anycable%2Fserverless-js)

# AnyCable Serverless

This package provides modules to implement [AnyCable](https://anycable.io) backend APIs to be executed in serverless Node.js environments.

> See our [demo application](https://github.com/anycable/vercel-anycable-demo) for a working example.

## Architecture and components

The package comes with HTTP handlers to handle [AnyCable RPC-over-HTTP](https://docs.anycable.io/architecture) requests and provides **channels** and **application** abstractions to describe real-time features of your application.

## Usage

Install the `@anycable/serverless-js` package using your tool of choice, e.g.:

```sh
npm install @anycable/serverless-js
```

### Configuring the application and channels

An **application** instance is responsible for handling the connection lifecycle and dispatching messages to the appropriate channels.

```js
// api/cable.ts
import {
  Application,
  ConnectionHandle,
  broadcaster,
  identificator,
} from "@anycable/serverless-js";

// The identifiers  type describe connection identifiers—e.g., user ID, username, etc.
export type CableIdentifiers = {
  userId: string;
};

// Application instance handles connection lifecycle events
class CableApplication extends Application<CableIdentifiers> {
  async connect(handle: ConnectionHandle<CableIdentifiers>) {
    const url = handle.env.url;
    const params = new URL(url).searchParams;

    if (params.has("token")) {
      const payload = await verifyToken(params.get("token")!);

      if (payload) {
        const { userId } = payload;

        handle.identifiedBy({ userId });
      }
      return;
    }

    // Reject connection if not authenticated
    handle.reject();
  }

  async disconnect(handle: ConnectionHandle<CableIdentifiers>) {
    // Here you can perform any cleanup work
    console.log(`User ${handle.identifiers!.userId} disconnected`);
  }
}

// Create and instance of the class to use in HTTP handlers (see the next section)
const app = new CableApplication();

// Register channels (see below)

export default app;
```

**Channels** instances reflect particular features (e.g, chat room, notifications, etc.) and are responsible for handling incoming commands and subscription lifecycle events:

```js
import { Channel, ChannelHandle } from "@/lib/anycable";
// We re-using the identifiers type from the cable application
import type { CableIdentifiers } from "../cable";

// Define the channel params (used by the client according to Action Cable protocol)
type ChatChannelParams = {
  roomId: string;
};

export type ChatMessage = {
  id: string;
  username: string;
  body: string;
  createdAt: string;
};

export default class ChatChannel
  extends Channel<CableIdentifiers, ChatChannelParams, ChatMessage>
{
  // The `subscribed` method is called when the client subscribes to the channel
  // You can use it to authorize the subscription and setup streaming
  async subscribed(
    handle: ChannelHandle<CableIdentifiers>,
    params: ChatChannelParams | null,
  ) {
    if (!params) {
      handle.reject();
      return;
    }

    if (!params.roomId) {
      handle.reject();
      return;
    }

    handle.streamFrom(`room:${params.roomId}`);
  }

  // This method is called by the client
  async sendMessage(
    handle: ChannelHandle<CableIdentifiers>,
    params: ChatChannelParams,
    data: SentMessage,
  ) {
    const { body } = data;

    if (!body) {
      throw new Error("Body is required");
    }

    console.log(
      `User ${handle.identifiers!.username} sent message: ${data.body}`,
    );

    const message: ChatMessage = {
      id: Math.random().toString(36).substr(2, 9),
      username: handle.identifiers!.username,
      body,
      createdAt: new Date().toISOString(),
    };

    // Broadcast the message to all subscribers (see below)
    await broadcastTo(`room:${params.roomId}`, message);
  }
}

// You MUST register a channel instance within the application
// The client MUST use the provided identifier to subscribe to the channel.
app.registerChannel("chat", new ChatChannel());
```

Finally, to **broadcast** messages to connected clients, you must use a broadcaster instance:

```js
// Broadcasting configuration
const broadcastURL =
  process.env.ANYCABLE_BROADCAST_URL || "http://127.0.0.1:8090/_broadcast";
const broadcastToken = process.env.ANYCABLE_HTTP_BROADCAST_SECRET || "";

// Create a broadcasting function to send broadcast messages via HTTP API
export const broadcastTo = broadcaster(broadcastURL, broadcastToken);
```

Currently, this package only supports broadcasting over HTTP. However, AnyCable provides different [broadcasting adapters](https://docs.anycable.io/ruby/broadcast_adapters) (e.g., Redis, NATS, etc.) that you can integrate yourself.

### HTTP handlers

To glue our HTTP layer with the channels, we need to configure HTTP handlers. Below you can find an examples for popular serverless platforms.

#### Vercel

Define [Vercel](https://vercel.com) serverless functions as follows:

```js
// api/anycable/connect/route.ts
import { NextResponse } from "next/server";
import { connectHandler, Status } from "@/lib/anycable";
import app from "../../cable";

export async function POST(request: Request) {
  try {
    const response = await connectHandler(request, app);
    return NextResponse.json(response, {
      status: 200,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({
      status: Status.ERROR,
      error_msg: "Server error",
    });
  }
}

// api/anycable/command/route.ts
import { NextResponse } from "next/server";
import { commandHandler, Status } from "@/lib/anycable";
import app from "../../cable";

export async function POST(request: Request) {
  try {
    const response = await commandHandler(request, app);
    return NextResponse.json(response, {
      status: 200,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({
      status: Status.ERROR,
      error_msg: "Server error",
    });
  }
}

// api/anycable/disconnect/route.ts
import { NextResponse } from "next/server";
import { disconnectHandler, Status } from "@/lib/anycable";
import app from "../../cable";

export async function POST(request: Request) {
  try {
    const response = await disconnectHandler(request, app);
    return NextResponse.json(response, {
      status: 200,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({
      status: Status.ERROR,
      error_msg: "Server error",
    });
  }
}
```

You can also avoid repeatition by using a universal handler and a bit of configuration:

```js
// next.config.js
const nextConfig = {
  // ...
  rewrites: async () => {
    return [
      {
        source: "/api/anycable/:path*",
        destination: "/api/anycable",
      },
    ];
  },
};

// ...
```

And then you can use the following handler:

```js
// api/anycable/route.ts
import { NextResponse } from "next/server";
import { handler, Status } from "@/lib/anycable";
import app from "../../cable";

export async function POST(request: Request) {
  try {
    const response = await handler(request, app);
    return NextResponse.json(response, {
      status: 200,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({
      status: Status.ERROR,
      error_msg: "Server error",
    });
  }
}
```
