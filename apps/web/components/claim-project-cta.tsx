export function ClaimProjectCta({ token }: { token: string }) {
  return (
    <section className="scan-claim" aria-labelledby="claim-project-title">
      <div>
        <p className="scan-mono-label">Keep this result</p>
        <h2 id="claim-project-title">Make this project yours.</h2>
        <p>
          Sign in only after the useful part. Claim this exact private result, then open your
          dashboard, monitoring options, or project-scoped agent access.
        </p>
      </div>
      <form action="/api/project-claims" method="post">
        <input name="deliveryToken" type="hidden" value={token} />
        <button name="intent" type="submit" value="save">
          Save this scan
        </button>
        <button name="intent" type="submit" value="monitor">
          Monitor this product
        </button>
        <button name="intent" type="submit" value="agent">
          Use with my agent
        </button>
      </form>
      <small>Google or e-mail magic link · no password · no auto-publishing</small>
    </section>
  );
}
