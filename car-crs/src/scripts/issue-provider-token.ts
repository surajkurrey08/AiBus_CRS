import { readCarSandboxConfig } from "../config/env.js";
import { issueProviderToken } from "../middleware/provider.js";

const [operatorId, providerId] = process.argv.slice(2);
if (!operatorId || !providerId) {
  console.error("Usage: issue-provider-token <operatorId> <providerId>");
  process.exit(2);
}

const config = readCarSandboxConfig();
console.log(
  issueProviderToken(config.CAR_PROVIDER_JWT_SECRET, operatorId, providerId),
);
