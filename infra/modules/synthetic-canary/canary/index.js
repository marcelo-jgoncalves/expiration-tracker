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

// `for await...of` over the response left `body` empty under the Synthetics runtime (real
// incident, 2026-09-19: canary failed continuously with "Unexpected end of JSON input" while
// the same endpoint returned a normal 200 body when hit directly) - AWS's own executeHttpStep
// examples read the body via the classic 'data'/'end' stream events instead, which is what
// this now does (docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Library_function_Nodejs.html).
function readResponseBody(response) {
  return new Promise((resolve, reject) => {
    let body = "";
    response.on("data", (chunk) => { body += chunk; });
    response.on("end", () => resolve(body));
    response.on("error", reject);
  });
}

async function expectAnonymousSession(response) {
  await expectStatus(200)(response);
  const body = await readResponseBody(response);
  const parsed = JSON.parse(body);
  if (parsed.authenticated !== false) {
    throw new Error("Anonymous session contract did not return authenticated=false");
  }
}

exports.handler = async () => {
  await synthetics.executeHttpStep("spa-edge", `${origin}/`, expectStatus(200));
  await synthetics.executeHttpStep("anonymous-session", `${origin}/bff/session`, expectAnonymousSession);
};
