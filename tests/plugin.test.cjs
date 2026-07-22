const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const pluginSource = fs.readFileSync(path.join(projectRoot, "main.js"), "utf8");
const languages = require(path.join(projectRoot, "languages.js"));

function createHarness(options = {}) {
  let request;
  const context = {
    $option: {
      apiKey: options.apiKey === undefined ? "test-key" : options.apiKey,
      model: options.model === undefined ? "openai/gpt-5.4" : options.model,
      thinkingMode: options.thinkingMode || "disable",
    },
    $http: {
      streamRequest(value) {
        if (options.requestError) {
          throw options.requestError;
        }
        request = value;
      },
    },
    require(identifier) {
      if (identifier === "./languages") {
        return languages;
      }
      throw new Error(`Unexpected module: ${identifier}`);
    },
  };

  vm.createContext(context);
  vm.runInContext(pluginSource, context, { filename: "main.js" });

  return {
    context,
    get request() {
      return request;
    },
  };
}

function createQuery(overrides = {}) {
  const streams = [];
  const completions = [];
  const query = {
    text: "Hello",
    originalText: "Hello\nworld",
    from: "auto",
    to: "zh-Hans",
    detectFrom: "en",
    detectTo: "zh-Hans",
    cancelSignal: { id: "cancel-signal" },
    onStream(value) {
      streams.push(normalize(value));
    },
    onCompletion(value) {
      completions.push(normalize(value));
    },
    ...overrides,
  };

  return { query, streams, completions };
}

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

test("exposes all Bob languages and a 120 second timeout", () => {
  const harness = createHarness();
  const supported = normalize(harness.context.supportLanguages());

  assert.equal(harness.context.pluginTimeoutInterval(), 120);
  assert.equal(supported.length, 390);
  assert.ok(supported.includes("auto"));
  assert.ok(supported.includes("zh-Hans"));
  assert.ok(supported.includes("en"));
  assert.ok(supported.includes("yue"));
});

test("builds the minimal Gateway request and preserves original formatting", () => {
  const harness = createHarness();
  const state = createQuery();

  harness.context.translate(state.query);

  assert.equal(harness.request.url, "https://ai-gateway.vercel.sh/v1/chat/completions");
  assert.equal(harness.request.method, "POST");
  assert.equal(harness.request.header.Authorization, "Bearer test-key");
  assert.equal(harness.request.header["Content-Type"], "application/json");
  assert.equal(harness.request.body.model, "openai/gpt-5.4");
  assert.equal(harness.request.body.stream, true);
  assert.equal(harness.request.body.reasoning, undefined);
  assert.match(harness.request.body.messages[1].content, /English to Chinese \(Simplified\)/);
  assert.match(harness.request.body.messages[1].content, /Hello\nworld$/);
  assert.equal(harness.request.cancelSignal, state.query.cancelSignal);
});

test("parses fragmented SSE and separates reasoning from translation", () => {
  const harness = createHarness({ thinkingMode: "enable" });
  const state = createQuery();
  harness.context.translate(state.query);

  assert.deepEqual(normalize(harness.request.body.reasoning), { enabled: true });

  const stream = [
    'data: {"choices":[{"delta":{"reasoning":"先分析"}}]}\r\n\r\n',
    'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
    'data: {"choices":[{"delta":{"reasoning":"再确认","content":"，世界"}}]}\n\n',
    "data: [DONE]\n\n",
  ].join("");

  const cuts = [11, 47, 88, 139, stream.length];
  let start = 0;
  for (const end of cuts) {
    harness.request.streamHandler({ text: stream.slice(start, end) });
    start = end;
  }
  harness.request.handler({ response: { statusCode: 200 } });

  assert.ok(state.streams.length >= 3);
  assert.deepEqual(state.streams.at(-1), {
    result: {
      from: "en",
      to: "zh-Hans",
      toParagraphs: ["你好，世界"],
      thinkInfo: { content: "先分析再确认" },
    },
  });
  assert.deepEqual(state.completions, [state.streams.at(-1)]);
});

test("reports missing credentials without starting a request", () => {
  const harness = createHarness({ apiKey: "  " });
  const state = createQuery();

  harness.context.translate(state.query);

  assert.equal(harness.request, undefined);
  assert.equal(state.completions.length, 1);
  assert.equal(state.completions[0].error.type, "secretKey");
});

test("maps HTTP authentication and model errors", () => {
  const authentication = createHarness();
  const authState = createQuery();
  authentication.context.translate(authState.query);
  authentication.request.streamHandler({
    text: '{"error":{"message":"invalid token","code":"unauthorized"}}',
  });
  authentication.request.handler({ response: { statusCode: 401 } });
  assert.equal(authState.completions[0].error.type, "secretKey");

  const model = createHarness();
  const modelState = createQuery();
  model.context.translate(modelState.query);
  model.request.handler({ response: { statusCode: 404 } });
  assert.equal(modelState.completions[0].error.type, "api");
  assert.match(modelState.completions[0].error.message, /模型不存在/);
});

test("completes only once when an SSE error is followed by the HTTP handler", () => {
  const harness = createHarness();
  const state = createQuery();
  harness.context.translate(state.query);

  harness.request.streamHandler({
    text: 'data: {"error":{"message":"model unavailable","code":"model_unavailable"}}\n\n',
  });
  harness.request.handler({ response: { statusCode: 200 } });
  harness.request.handler({ response: { statusCode: 200 } });

  assert.equal(state.completions.length, 1);
  assert.equal(state.completions[0].error.type, "api");
  assert.equal(state.completions[0].error.message, "model unavailable");
});
