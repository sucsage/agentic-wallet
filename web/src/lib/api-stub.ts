/** Contract-backed routes stay deliberately offline while the UI is a prototype. */
export function contractApiStub() {
  return Response.json(
    {
      mode: "mockup",
      error: "Contract API is not connected yet. Use the local-only mockup interface.",
    },
    { status: 501 },
  );
}
