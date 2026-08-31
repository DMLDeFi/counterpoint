// RYO's slow tools (deep_analysis, compare_tokens) can take 30-55s. A plain
// buffered response sends zero bytes for that whole window, and long silent
// connections get killed by browsers/proxies/antivirus somewhere in the path
// even though the server itself is fine. Streaming a heartbeat keeps bytes
// flowing so the connection is never idle, then the real JSON lands at the end.
//
// Because headers are already committed as 200 once streaming starts, errors
// are reported inside the JSON body (`{ error: string }`) rather than via
// HTTP status — callers must check `body.error`, not `res.ok`.
export function streamJsonResponse(work: () => Promise<unknown>, heartbeatMs = 5_000): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(" "));
      }, heartbeatMs);

      try {
        const result = await work();
        clearInterval(heartbeat);
        controller.enqueue(encoder.encode(JSON.stringify(result)));
      } catch (err) {
        clearInterval(heartbeat);
        const message = err instanceof Error ? err.message : "Unknown error";
        controller.enqueue(encoder.encode(JSON.stringify({ error: message })));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
