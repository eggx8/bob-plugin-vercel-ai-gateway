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
  let validationRequest;
  const context = {
    $option: {
      apiKey: options.apiKey === undefined ? "test-key" : options.apiKey,
      model:
        options.model === undefined
          ? "poolside/laguna-s-2.1-free"
          : options.model,
      thinkingMode:
        options.thinkingMode === undefined ? "default" : options.thinkingMode,
    },
    $http: {
      request(value) {
        if (options.requestError) {
          throw options.requestError;
        }
        validationRequest = value;
      },
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
    get validationRequest() {
      return validationRequest;
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
  assert.equal(harness.request.header.Accept, "text/event-stream");
  assert.equal(harness.request.header["Accept-Encoding"], "identity");
  assert.equal(harness.request.header["Cache-Control"], "no-cache");
  assert.equal(harness.request.header["Content-Type"], "application/json");
  assert.equal(harness.request.body.model, "poolside/laguna-s-2.1-free");
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
    'data: {"choices":[{"delta":{"reasoning_content":"再确认","content":"，世界"}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
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
  const expectedResult = {
    from: "en",
    to: "zh-Hans",
    toParagraphs: ["你好，世界"],
    thinkInfo: { content: "先分析再确认" },
  };
  assert.deepEqual(state.streams.at(-1), expectedResult);
  assert.deepEqual(state.completions, [{ result: expectedResult }]);
});

test("streams reasoning_content before translated content arrives", () => {
  const harness = createHarness({ thinkingMode: "enable" });
  const state = createQuery();
  harness.context.translate(state.query);

  harness.request.streamHandler({
    text: 'data: {"choices":[{"delta":{"reasoning_content":"正在分析"}}]}\n\n',
  });

  assert.deepEqual(state.streams, [
    {
      from: "en",
      to: "zh-Hans",
      toParagraphs: [],
      thinkInfo: { content: "正在分析" },
    },
  ]);

  harness.request.streamHandler({
    text: [
      'data: {"choices":[{"delta":{"content":"你好"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      "",
    ].join("\n\n"),
  });
  harness.request.handler({ response: { statusCode: 200 } });

  assert.deepEqual(state.completions[0].result, {
    from: "en",
    to: "zh-Hans",
    toParagraphs: ["你好"],
    thinkInfo: { content: "正在分析" },
  });
});

test("does not duplicate reasoning when both field variants are present", () => {
  const harness = createHarness();
  const state = createQuery();
  harness.context.translate(state.query);

  harness.request.streamHandler({
    text: [
      'data: {"choices":[{"delta":{"reasoning":"标准字段","reasoning_content":"兼容字段"}}]}',
      'data: {"choices":[{"delta":{"content":"你好"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      "",
    ].join("\n\n"),
  });
  harness.request.handler({ response: { statusCode: 200 } });

  assert.equal(state.completions[0].result.thinkInfo.content, "标准字段");
});

test("uses provider-default reasoning when the mode is default", () => {
  const harness = createHarness();
  const state = createQuery();
  harness.context.translate(state.query);

  assert.equal(harness.request.body.reasoning, undefined);
  harness.request.streamHandler({
    text: [
      'data: {"choices":[{"delta":{"reasoning":"模型默认思考"}}]}',
      'data: {"choices":[{"delta":{"content":"你好"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      "",
    ].join("\n\n"),
  });
  harness.request.handler({ response: { statusCode: 200 } });

  assert.deepEqual(state.completions[0].result, {
    from: "en",
    to: "zh-Hans",
    toParagraphs: ["你好"],
    thinkInfo: { content: "模型默认思考" },
  });
});

test("explicitly disables reasoning and does not display it", () => {
  const harness = createHarness({ thinkingMode: "disable" });
  const state = createQuery();
  harness.context.translate(state.query);

  assert.deepEqual(normalize(harness.request.body.reasoning), { enabled: false });
  harness.request.streamHandler({
    text: [
      'data: {"choices":[{"delta":{"reasoning":"不应显示"}}]}',
      'data: {"choices":[{"delta":{"content":"你好"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      "",
    ].join("\n\n"),
  });
  harness.request.handler({ response: { statusCode: 200 } });

  assert.deepEqual(state.completions[0].result, {
    from: "en",
    to: "zh-Hans",
    toParagraphs: ["你好"],
  });
});

test("streams CR-only SSE and handles CRLF split between chunks", () => {
  const harness = createHarness();
  const state = createQuery();
  harness.context.translate(state.query);

  harness.request.streamHandler({
    text: 'data: {"choices":[{"delta":{"content":"你"}}]}\r\r',
  });
  assert.deepEqual(state.streams.at(-1).toParagraphs, ["你"]);

  harness.request.streamHandler({
    text: 'data: {"choices":[{"delta":{"content":"好"}}]}\r',
  });
  harness.request.streamHandler({ text: "\n\r" });
  assert.deepEqual(state.streams.at(-1).toParagraphs, ["你好"]);

  harness.request.streamHandler({
    text: '\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\r\n\r\n',
  });
  harness.request.handler({ response: { statusCode: 200 } });
  assert.deepEqual(state.completions[0].result.toParagraphs, ["你好"]);
});

test("reports missing credentials without starting a request", () => {
  const harness = createHarness({ apiKey: "  " });
  const state = createQuery();

  harness.context.translate(state.query);

  assert.equal(harness.request, undefined);
  assert.equal(state.completions.length, 1);
  assert.equal(state.completions[0].error.type, "secretKey");
});

test("supports Bob native validation for credentials and model access", () => {
  const missing = createHarness({ apiKey: "  " });
  const missingResults = [];
  missing.context.pluginValidate((value) => missingResults.push(normalize(value)));
  assert.equal(missing.validationRequest, undefined);
  assert.equal(missingResults[0].result, false);
  assert.equal(missingResults[0].error.type, "secretKey");

  const harness = createHarness();
  const results = [];
  harness.context.pluginValidate((value) => results.push(normalize(value)));
  assert.equal(harness.validationRequest.method, "POST");
  assert.equal(harness.validationRequest.body.model, "poolside/laguna-s-2.1-free");
  assert.equal(harness.validationRequest.body.stream, false);
  harness.validationRequest.handler({
    data: { choices: [{ message: { content: "OK" } }] },
    response: { statusCode: 200 },
  });
  assert.deepEqual(results, [{ result: true }]);
});

test("maps validation failures to Bob service errors", () => {
  const harness = createHarness();
  const results = [];
  harness.context.pluginValidate((value) => results.push(normalize(value)));
  harness.validationRequest.handler({
    data: { error: { message: "invalid token", code: "unauthorized" } },
    response: { statusCode: 401 },
  });

  assert.equal(results[0].result, false);
  assert.equal(results[0].error.type, "secretKey");
  assert.equal(results[0].error.troubleshootingLink, "https://vercel.com/ai-gateway");
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

test("rejects malformed, truncated, and incomplete streams", () => {
  const cases = [
    {
      chunks: [
        'data: {"choices":[{"delta":{"content":"部分"}}]}\n\n',
        "data: {broken json}\n\n",
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      ],
      expectedType: "api",
      message: /无法解析/,
    },
    {
      chunks: [
        'data: {"choices":[{"delta":{"content":"部分"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
      ],
      expectedType: "api",
      message: /长度限制/,
    },
    {
      chunks: [
        'data: {"choices":[{"delta":{"content":"部分"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}\n\n',
      ],
      expectedType: "api",
      message: /安全策略/,
    },
    {
      chunks: ['data: {"choices":[{"delta":{"content":"部分"}}]}\n\n'],
      expectedType: "network",
      message: /完成前中断/,
    },
  ];

  for (const item of cases) {
    const harness = createHarness();
    const state = createQuery();
    harness.context.translate(state.query);
    for (const chunk of item.chunks) {
      harness.request.streamHandler({ text: chunk });
    }
    harness.request.handler({ response: { statusCode: 200 } });

    assert.equal(state.completions.length, 1);
    assert.equal(state.completions[0].error.type, item.expectedType);
    assert.match(state.completions[0].error.message, item.message);
  }
});
