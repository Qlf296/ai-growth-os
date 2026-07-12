/**
 * AT-boundaries — module import graph obeys declared boundaries (S2 §2, BUILD_RULES step 1).
 * Groundwork for AT-6 (single LLM path) and AT-7 (single send path): SDK allowlists live here
 * from commit #1 even though the packages are empty shells until steps 6–7.
 */
const MODEL_SDKS = '^(openai|@anthropic-ai/.*|@google/generative-ai|cohere-ai|groq-sdk)$';
const SEND_SDKS = '^(resend|@sendgrid/.*|postmark|nodemailer|web-push|firebase-admin)$';

module.exports = {
  forbidden: [
    {
      name: 'no-package-imports-app',
      comment: 'packages/* may never depend on apps/* (S2 §2 boundary rule)',
      severity: 'error',
      from: { path: '^packages' },
      to: { path: '^apps' },
    },
    {
      name: 'domain-is-framework-free',
      comment: 'packages/domain imports no framework and no other module (AT-boundaries; S2 §5)',
      severity: 'error',
      from: { path: '^packages/domain' },
      to: {
        path: '^(apps|packages/(?!domain))',
      },
    },
    {
      name: 'domain-no-framework-deps',
      severity: 'error',
      from: { path: '^packages/domain' },
      to: { path: '^(express|@nestjs/.*|react|next|prisma|@prisma/.*|ioredis|pg)$' },
    },
    {
      name: 'AT-6-single-llm-path',
      comment: 'Model SDKs importable only within packages/ai-gateway (I6)',
      severity: 'error',
      from: { pathNot: '^packages/ai-gateway' },
      to: { path: MODEL_SDKS },
    },
    {
      name: 'AT-7-single-send-path',
      comment: 'Email/push SDKs importable only within packages/delivery (I7)',
      severity: 'error',
      from: { pathNot: '^packages/delivery' },
      to: { path: SEND_SDKS },
    },
    {
      name: 'no-deep-imports-across-packages',
      comment: 'Modules communicate through their public interface (src/index.ts), never internals',
      severity: 'error',
      from: { path: '^(apps|packages)/([^/]+)/' },
      to: {
        path: '^packages/([^/]+)/src/(?!index\\.ts$).+',
        pathNot: '^packages/$2/',
      },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.base.json' },
    exclude: { path: '\\.(test|spec)\\.ts$' },
  },
};
