export type EmbedSnippetsInput = Readonly<{
    /** The Happier web app the frame loads from (`HappierSession happierUrl`). */
    happierUrl: string;
    /** The Home the backend SDK talks to (`connect({ endpoint })`). */
    serverUrl: string;
    /** The embed's listing organization: without a folder or a tag there is nothing safe to list. */
    hasListingOrganization: boolean;
    /** Plain words for the organization, used in the listing comment ("folder Leads · tag inbound"). */
    organizationLabel: string | null;
    /** The key can create sessions (`grant.create`). */
    createAllowed: boolean;
    /** The embed shows a new-chat composer (`embedConfig.newChat.enabled`); requires `createAllowed`. */
    newChat: boolean;
}>;

export type EmbedSnippets = Readonly<{
    backend: string;
    react: string;
    /** Rendered only once `@happier-dev/embed` is published (plan 04 §4.10, release check). */
    scriptTag: string;
}>;

function quote(value: string): string {
    return JSON.stringify(value).replaceAll("'", "\\'").replace(/^"|"$/g, "'");
}

/**
 * The one formatter of the copy-paste snippets (plan 04 §4.1, §4.10). Pure: it reads nothing and
 * holds no key; the key is referenced as `HAPPIER_EMBED_KEY`. The backend snippet declares the one
 * rule the host must write, `canOpenSession`; it is the host's authorization and the snippet does
 * not work without it. Listing is emitted only when the embed has a folder or tag to list by.
 */
export function buildEmbedSnippetsV1(input: EmbedSnippetsInput): EmbedSnippets {
    const newChat = input.createAllowed && input.newChat;
    const backend: string[] = [
        `import { connect } from '@happier-dev/sdk';`,
        ``,
        `// The embed key is shown once in Happier → Settings → Embeds. Keep it on your server.`,
        `const happier = connect({ endpoint: ${quote(input.serverUrl)}, token: process.env.HAPPIER_EMBED_KEY! });`,
        ``,
        `// YOUR RULE: may this signed-in user open this Happier chat? (for example, the user owns the lead)`,
        `declare function canOpenSession(userId: string, sessionId: string): Promise<boolean>;`,
    ];
    if (newChat) {
        backend.push(
            `// YOUR STORE: idempotently attach a server-verified new chat to this user's record.`,
            `// canOpenSession above must read the same ownership store for later renewals.`,
            `declare function saveCreatedSession(userId: string, sessionId: string): Promise<void>;`,
            `// Retain creator attribution until the original child expires, including exchange retries.`,
            `const newChatIssuedTo = new Map<string, { userId: string; expiresAt: number }>();`,
        );
    }
    if (input.createAllowed) {
        backend.push(
            ``,
            `// Start a chat from your server. It runs on this embed's computer and agent, in its folder and tags.`,
            `export async function createChat(title: string, initialMessage: string) {`,
            `  const session = await happier.embed.createSession({ title, initialMessage });`,
            `  return session.id; // store it with your record`,
            `}`,
        );
    }
    backend.push(``);
    if (input.hasListingOrganization) {
        backend.push(
            `// List this embed's chats${input.organizationLabel ? ` (${input.organizationLabel})` : ''}. Your rule above still decides who may open each.`,
            `export const listChats = () => happier.embed.listSessions();`,
        );
    } else {
        backend.push(
            `// Listing is off: this embed has no folder or tag to list by, and it never lists the whole account.`,
            `// Choose a folder or a tag in Happier → Settings → Embeds to list this embed's chats here.`,
        );
    }
    backend.push(
        ``,
        `// A short-lived browser credential for one chat, issued only after your rule allows it.`,
        `app.post('/api/happier/credential', requireSignedInUser, async (req, res) => {`,
        `  const { sessionId, embedPublicKey, reason, createdByTokenId } = req.body;`,
    );
    if (newChat) {
        backend.push(
            `  for (const [tokenId, issued] of newChatIssuedTo) {`,
            `    if (issued.expiresAt <= Date.now()) newChatIssuedTo.delete(tokenId);`,
            `  }`,
            `  if (!sessionId) {`,
            `    const credential = await happier.embed.createCredential({ embedPublicKey, expiresInSeconds: 900 });`,
            `    newChatIssuedTo.set(credential.tokenId, { userId: req.user.id, expiresAt: Date.parse(credential.expiresAt) });`,
            `    return res.json(credential);`,
            `  }`,
            `  if (reason === 'created') {`,
            `    if (!createdByTokenId || newChatIssuedTo.get(createdByTokenId)?.userId !== req.user.id) return res.sendStatus(403);`,
            `    const credential = await happier.embed.createCredential({`,
            `      sessionId, embedPublicKey, expiresInSeconds: 900,`,
            `      requireCreatedBy: createdByTokenId, // Happier checks the chat was created by that credential`,
            `    });`,
            `    await saveCreatedSession(req.user.id, sessionId); // never trust onSessionCreated alone`,
            `    return res.json(credential);`,
            `  }`,
        );
    } else {
        backend.push(`  if (!sessionId || reason === 'created' || createdByTokenId) return res.sendStatus(400);`);
    }
    backend.push(
        `  if (!(await canOpenSession(req.user.id, sessionId))) return res.sendStatus(403);`,
        `  res.json(await happier.embed.createCredential({ sessionId, embedPublicKey, expiresInSeconds: 900 }));`,
        `});`,
    );

    const getCredential = [
        `getCredential={(request) => fetch('/api/happier/credential', {`,
        `    method: 'POST',`,
        `    headers: { 'content-type': 'application/json' },`,
        `    body: JSON.stringify(request),`,
        `  }).then((response) => {`,
        `    if (!response.ok) throw Object.assign(new Error('Credential request failed'), {`,
        `      code: response.status === 400 || response.status === 403 ? 'credential_rejected' : 'credential_unavailable',`,
        `    });`,
        `    return response.json();`,
        `  })}`,
    ];
    const react: string[] = [
        `import { HappierSession } from '@happier-dev/embed/react';`,
        ``,
        `export function Chat({ sessionId, title }: { sessionId${newChat ? '?: string' : ': string'}; title: string }) {`,
        `  return (`,
        `    <HappierSession`,
        `      happierUrl=${quote(input.happierUrl)}`,
        `      sessionId={sessionId}`,
        `      containerStyle={{ height: 640 }}`,
        `      ${getCredential.join('\n      ')}`,
        `      title={title}`,
        ...(newChat ? [`      onSessionCreated={({ sessionId: created }) => { /* store the new chat's id */ void created; }}`] : []),
        `    />`,
        `  );`,
        `}`,
    ];

    const scriptTag = [
        `<div id="happier-chat" style="height:640px"></div>`,
        `<script type="module">`,
        `  import { mountHappierSession } from 'https://cdn.jsdelivr.net/npm/@happier-dev/embed@1/+esm';`,
        `  mountHappierSession(document.getElementById('happier-chat'), {`,
        `    happierUrl: ${quote(input.happierUrl)},`,
        `    sessionId: 'SESSION_ID',`,
        `    getCredential: (request) => fetch('/api/happier/credential', {`,
        `      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),`,
        `    }).then((response) => {`,
        `      if (!response.ok) throw Object.assign(new Error('Credential request failed'), {`,
        `        code: response.status === 400 || response.status === 403 ? 'credential_rejected' : 'credential_unavailable',`,
        `      });`,
        `      return response.json();`,
        `    }),`,
        `  });`,
        `</script>`,
    ];

    return { backend: backend.join('\n'), react: react.join('\n'), scriptTag: scriptTag.join('\n') };
}
