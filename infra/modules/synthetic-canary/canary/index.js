// AWS injects the Synthetics library as a CommonJS-only runtime module.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { synthetics } = require("@aws/synthetics-core");

const origin = process.env.APP_ORIGIN;

function expectStatus(expected) {
  return async (response) => {
    if (response.statusCode !== expected) {
      throw new Error(`Expected HTTP ${expected}, received ${response.statusCode}`);
    }
  };
}

async function expectAnonymousSession(response) {
  await expectStatus(200)(response);
  let body = "";
  for await (const chunk of response) body += chunk;
  const parsed = JSON.parse(body);
  if (parsed.authenticated !== false) {
    throw new Error("Anonymous session contract did not return authenticated=false");
  }
}

exports.handler = async () => {
  await synthetics.executeHttpStep("spa-edge", `${origin}/`, expectStatus(200));
  await synthetics.executeHttpStep("anonymous-session", `${origin}/bff/session`, expectAnonymousSession);
};
