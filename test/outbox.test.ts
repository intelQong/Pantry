// The offline queue's decision rules.
//
// These run without a browser: everything tested here is pure, and `drain`
// takes its sender as an argument precisely so a test can hand it fake
// responses instead of a network.

import { describe, it, expect } from "vitest";
import {
  classify,
  describeRequest,
  drain,
  enqueue,
  removeOp,
  remapEntryId,
  isResolvedLocally,
  type OutboxOp,
  type SendResult,
} from "../src/client/lib/outbox";

const buy = (id: string, entryId = `entry-${id}`): OutboxOp => ({
  kind: "buy",
  id,
  createdAt: 1_700_000_000,
  attempts: 0,
  entryId,
  qty: null,
  priceTotal: null,
});

/** A sender that replies from a script, and records what it was asked to send. */
function scripted(replies: SendResult[]) {
  const sent: OutboxOp[] = [];
  let i = 0;
  return {
    sent,
    send: async (op: OutboxOp) => {
      sent.push(op);
      return replies[i++] ?? { status: 200 };
    },
  };
}

describe("classify", () => {
  it("treats a 2xx as synced", () => {
    expect(classify({ status: 200 })).toEqual({ type: "synced" });
    expect(classify({ status: 201 })).toEqual({ type: "synced" });
  });

  it("separates an already-resolved buy from a fresh one", () => {
    expect(classify({ status: 200, body: { alreadyResolved: true } })).toEqual({ type: "already" });
    expect(classify({ status: 200, body: { alreadyResolved: false } })).toEqual({ type: "synced" });
  });

  // Skip 404s once the entry is no longer pending, and buy 404s when it is gone
  // outright. Both mean the queue got what it wanted, so retrying would spin
  // forever against a row that is never coming back.
  it("treats a 404 as already resolved rather than a failure", () => {
    expect(classify({ status: 404 })).toEqual({ type: "already" });
  });

  it("retries when there was no response at all", () => {
    expect(classify({ status: null })).toEqual({ type: "retry" });
  });

  it("retries a server error", () => {
    expect(classify({ status: 500 })).toEqual({ type: "retry" });
    expect(classify({ status: 503 })).toEqual({ type: "retry" });
  });

  it("drops any other 4xx, carrying the server's message", () => {
    const outcome = classify({ status: 400, body: { message: "That item doesn't exist." } });
    expect(outcome).toEqual({ type: "dropped", reason: "That item doesn't exist." });
  });

  it("drops a 401 rather than blocking the queue behind a dead session", () => {
    expect(classify({ status: 401 }).type).toBe("dropped");
  });
});

describe("drain", () => {
  it("empties a queue that sends cleanly", async () => {
    const { send } = scripted([{ status: 200 }, { status: 200 }, { status: 200 }]);
    const { queue, summary } = await drain([buy("a"), buy("b"), buy("c")], send);

    expect(queue).toEqual([]);
    expect(summary).toMatchObject({ synced: 3, already: 0, stalled: false });
  });

  it("sends strictly in order", async () => {
    // An add has to land before the buy that resolves the entry it created.
    const { sent, send } = scripted([{ status: 200 }, { status: 200 }, { status: 200 }]);
    await drain([buy("first"), buy("second"), buy("third")], send);
    expect(sent.map((op) => op.id)).toEqual(["first", "second", "third"]);
  });

  it("stops at the first network failure and keeps the rest in order", async () => {
    const { sent, send } = scripted([{ status: 200 }, { status: null }]);
    const { queue, summary } = await drain([buy("a"), buy("b"), buy("c")], send);

    expect(summary.stalled).toBe(true);
    expect(summary.synced).toBe(1);
    expect(queue.map((op) => op.id)).toEqual(["b", "c"]);
    // "c" was never attempted — order is preserved rather than raced.
    expect(sent.map((op) => op.id)).toEqual(["a", "b"]);
  });

  it("counts an attempt on the operation it stalled at", async () => {
    const { send } = scripted([{ status: null }]);
    const { queue } = await drain([buy("a")], send);
    expect(queue[0]?.attempts).toBe(1);
  });

  it("drops a rejected operation and keeps going", async () => {
    // The whole point: one unacceptable operation must not strand the ones
    // behind it, which is what would happen if a 4xx were retried forever.
    const { send } = scripted([{ status: 400, body: { message: "No such item." } }, { status: 200 }]);
    const { queue, summary } = await drain([buy("bad"), buy("good")], send);

    expect(queue).toEqual([]);
    expect(summary.synced).toBe(1);
    expect(summary.dropped).toHaveLength(1);
    expect(summary.dropped[0]).toMatchObject({ reason: "No such item." });
    expect(summary.dropped[0]?.op.id).toBe("bad");
  });

  it("counts what the other phone already bought", async () => {
    const { send } = scripted([
      { status: 200, body: { alreadyResolved: true } },
      { status: 200 },
    ]);
    const { summary } = await drain([buy("a"), buy("b")], send);
    expect(summary).toMatchObject({ synced: 1, already: 1 });
  });

  it("treats a sender that throws as a dead network", async () => {
    const { queue, summary } = await drain([buy("a")], async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(summary.stalled).toBe(true);
    expect(queue.map((op) => op.id)).toEqual(["a"]);
  });

  it("does nothing with an empty queue", async () => {
    const { queue, summary } = await drain([], async () => ({ status: 200 }));
    expect(queue).toEqual([]);
    expect(summary).toMatchObject({ synced: 0, already: 0, stalled: false });
  });
});

describe("adding and buying the same item offline", () => {
  const add = (id: string, name: string): OutboxOp => ({
    kind: "add",
    id,
    createdAt: 1_700_000_000,
    attempts: 0,
    itemId: null,
    customName: name,
    qty: null,
  });

  // Spot something on the shelf, add it, tick it off, all with no signal. The
  // buy can only reference the local id, because that is the only id that
  // exists until the add reaches a server.
  it("repoints a queued buy at the id the server gave the add", async () => {
    const sent: OutboxOp[] = [];
    const send = async (op: OutboxOp): Promise<SendResult> => {
      sent.push(op);
      return op.kind === "add" ? { status: 201, entryId: "server-id" } : { status: 200 };
    };

    const { queue, summary } = await drain([add("local-id", "Mangoes"), buy("b", "local-id")], send);

    expect(queue).toEqual([]);
    expect(summary.synced).toBe(2);
    const sentBuy = sent.find((op) => op.kind === "buy");
    expect(sentBuy && "entryId" in sentBuy && sentBuy.entryId).toBe("server-id");
  });

  it("leaves the buy queued, and repointed, when the network dies after the add", async () => {
    const send = async (op: OutboxOp): Promise<SendResult> =>
      op.kind === "add" ? { status: 201, entryId: "server-id" } : { status: null };

    const { queue, summary } = await drain([add("local-id", "Mangoes"), buy("b", "local-id")], send);

    expect(summary.stalled).toBe(true);
    expect(queue).toHaveLength(1);
    // The repoint must survive the stall, or the retry goes back to a local id
    // the server has never heard of and 404s forever.
    expect(queue[0] && "entryId" in queue[0] && queue[0].entryId).toBe("server-id");
  });

  it("leaves unrelated entries alone when repointing", () => {
    const q = [buy("a", "local-id"), buy("b", "other-entry")];
    const mapped = remapEntryId(q, "local-id", "server-id");
    expect(mapped[0] && "entryId" in mapped[0] && mapped[0].entryId).toBe("server-id");
    expect(mapped[1] && "entryId" in mapped[1] && mapped[1].entryId).toBe("other-entry");
  });
});

describe("what each operation asks the server for", () => {
  // The regression that prompted this: Shop Mode's Skip button called the buy
  // handler, so skipping an item wrote a purchase row, stamped
  // last_purchased_at, and fed the median that sets the restock interval. The
  // app learned you restock the things you deliberately walked past.
  it("sends a skip to /skip, and never to /bought", () => {
    const req = describeRequest({
      kind: "skip",
      id: "op-1",
      createdAt: 1_700_000_000,
      attempts: 0,
      entryId: "entry-9",
    });

    expect(req).toEqual({ method: "POST", path: "/list/entry-9/skip", body: {} });
    expect(req.path).not.toContain("bought");
    // Nothing in a skip may look like a purchase to the server.
    expect(req.body).not.toHaveProperty("priceTotal");
    expect(req.body).not.toHaveProperty("purchasedAt");
    expect(req.body).not.toHaveProperty("qty");
  });

  it("sends a buy with the time it was ticked off, not the time it syncs", () => {
    const req = describeRequest({
      kind: "buy",
      id: "op-2",
      createdAt: 1_699_000_000,
      attempts: 0,
      entryId: "entry-3",
      qty: 2,
      priceTotal: 25000,
    });

    expect(req.path).toBe("/list/entry-3/bought");
    expect(req.body).toEqual({ qty: 2, priceTotal: 25000, purchasedAt: 1_699_000_000 });
  });

  it("omits qty from a buy when none was chosen, so the server's default stands", () => {
    const req = describeRequest({
      kind: "buy",
      id: "op-3",
      createdAt: 1,
      attempts: 0,
      entryId: "e",
      qty: null,
      priceTotal: null,
    });
    expect(req.body).not.toHaveProperty("qty");
    expect(req.body.priceTotal).toBeNull();
  });

  it("stamps an add with its own id, which is what makes the retry safe", () => {
    const req = describeRequest({
      kind: "add",
      id: "op-4",
      createdAt: 1,
      attempts: 0,
      itemId: null,
      customName: "Napkins",
      qty: null,
    });
    expect(req.path).toBe("/list");
    expect(req.body).toEqual({ clientId: "op-4", customName: "Napkins" });
  });

  it("sends a known item by id rather than by name", () => {
    const req = describeRequest({
      kind: "add",
      id: "op-5",
      createdAt: 1,
      attempts: 0,
      itemId: "item-7",
      customName: null,
      qty: 3,
    });
    expect(req.body).toEqual({ clientId: "op-5", itemId: "item-7", qty: 3 });
  });
});

describe("queue bookkeeping", () => {
  it("appends to the end so order survives", () => {
    const q = enqueue(enqueue([], buy("a")), buy("b"));
    expect(q.map((op) => op.id)).toEqual(["a", "b"]);
  });

  it("removes by id without touching the rest", () => {
    const q = [buy("a"), buy("b"), buy("c")];
    expect(removeOp(q, "b").map((op) => op.id)).toEqual(["a", "c"]);
  });

  it("knows an entry already has a queued buy, so a second tap is ignorable", () => {
    const q = [buy("a", "entry-1")];
    expect(isResolvedLocally(q, "entry-1")).toBe(true);
    expect(isResolvedLocally(q, "entry-2")).toBe(false);
  });

  it("does not consider a queued add to have resolved anything", () => {
    const add: OutboxOp = {
      kind: "add",
      id: "x",
      createdAt: 1,
      attempts: 0,
      itemId: null,
      customName: "Napkins",
      qty: null,
    };
    expect(isResolvedLocally([add], "x")).toBe(false);
  });
});
