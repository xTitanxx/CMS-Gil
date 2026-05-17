export function buildInviteMessage(name: string, code: string, baseUrl: string): string {
  // Trailing slashes on baseUrl would yield `https://gilalter.com//welcome` — strip.
  const root = baseUrl.replace(/\/+$/, "");
  const autoLoginUrl = `${root}/welcome?code=${encodeURIComponent(code)}`;

  return `Hey ${name} 👋

I've been quietly building something new — and you're one of the first people I want to invite.

gilalter.com is now live as an experimental archive of my posts and content. It's still early and rough around the edges, but it's yours to explore.

The thing I'm most excited about: there's an Archivist you can chat with — an AI that knows my archive and can help you find anything I've ever posted.

The easiest way in — just tap this link and it'll sign you in automatically:

${autoLoginUrl}

Or, if you'd rather type it yourself, go to gilalter.com/welcome and enter your personal access code:

${code}

Fair warning — it's experimental. Things might break, look weird, or not work perfectly. I'm treating this as a living project and will keep improving it over time.

Would love to hear what you think.

— Gil`;
}
