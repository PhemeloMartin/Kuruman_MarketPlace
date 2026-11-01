import { Response } from "express";

// Routes that run inside a database transaction answer (res.json) while the transaction is still open,
// and the helper runs COMMIT afterwards. Sent straight away, that answer would say "done" a moment
// before the change is saved - a screen that reloads at once could still show the old data - and if
// COMMIT then failed, the answer would already have said it worked. So the transaction helpers hold
// the answer back and send it only once the transaction is finished.
//
// res.json and res.sendStatus both end in res.send, so holding res.send holds every kind of answer.
export function holdResponse(res: Response) {
  const send = res.send;
  let held: { body: unknown } | null = null;
  res.send = function (body?: unknown) {
    held = { body };
    return res;
  } as Response["send"];

  return {
    // The transaction is finished (saved, or rolled back by the route itself): send the answer now.
    release() {
      res.send = send;
      if (held) {
        const { body } = held;
        held = null;
        res.send(body);
      }
    },
    // The transaction failed: forget the answer, so the error handler can answer instead.
    drop() {
      res.send = send;
      held = null;
    },
  };
}
