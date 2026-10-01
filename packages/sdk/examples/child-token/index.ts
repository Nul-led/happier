import { connect } from '@happier-dev/sdk';

const endpoint = process.env.HAPPIER_API_ENDPOINT;
const token = process.env.HAPPIER_TOKEN;
const sessionId = process.env.HAPPIER_SESSION_ID;
const origin = process.env.HAPPIER_EMBED_ORIGIN;
const expiresAt = process.env.HAPPIER_CHILD_EXPIRES_AT;
if (!endpoint || !token || !sessionId || !origin || !expiresAt) {
  throw new Error('Set HAPPIER_API_ENDPOINT, HAPPIER_TOKEN, HAPPIER_SESSION_ID, HAPPIER_EMBED_ORIGIN and HAPPIER_CHILD_EXPIRES_AT.');
}

const parent = connect({ endpoint, token });
try {
  const self = await parent.apiTokens.self();
  const created = await parent.apiTokens.createChild({
    label: 'Session viewer',
    expiresAt,
    grant: {
      v: 1,
      actions: { families: [], ids: ['session.transcript.get'] },
      targets: { sessions: [sessionId], machines: [] },
      approve: false,
      origins: [origin],
      models: self.grant.models,
      permissionModes: self.grant.permissionModes,
      create: null,
    },
  });
  try {
    const child = connect({ endpoint, token: created.token });
    try {
      console.log(await child.apiTokens.self());
    } finally { await child.close(); }
  } finally {
    await parent.apiTokens.revokeChild(created.apiToken.tokenId);
  }
} finally { await parent.close(); }
