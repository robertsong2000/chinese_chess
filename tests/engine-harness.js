const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");

const ROOT = path.join(__dirname, "..");
const CONSTANTS_PATH = path.join(ROOT, "src", "constants.js");
const RULES_PATH = path.join(ROOT, "src", "rules.js");
const SEARCH_PATH = path.join(ROOT, "src", "search.js");
const APP_PATH = path.join(ROOT, "app.js");
const INITIALIZATION = /\nbindEvents\(\);\nloadGame\(\);\nsyncSettingsUI\(\);\nrender\(\);\s*$/;

function createEngine() {
  const constantsSrc = fs.readFileSync(CONSTANTS_PATH, "utf8");
  const rulesSrc = fs.readFileSync(RULES_PATH, "utf8");
  const searchSrc = fs.readFileSync(SEARCH_PATH, "utf8");
  const appSource = fs.readFileSync(APP_PATH, "utf8").replace(INITIALIZATION, "");
  const context = vm.createContext({
    console,
    performance,
    setTimeout,
    clearTimeout,
    document: {
      querySelector: () => ({}),
      querySelectorAll: () => [],
    },
  });
  // 加载顺序:constants.js → rules.js → search.js → app.js(共享全局词法环境)。
  vm.runInContext(constantsSrc, context, { filename: CONSTANTS_PATH });
  vm.runInContext(rulesSrc, context, { filename: RULES_PATH });
  vm.runInContext(searchSrc, context, { filename: SEARCH_PATH });
  vm.runInContext(appSource, context, { filename: APP_PATH });

  return {
    evaluate(expression) {
      return vm.runInContext(expression, context);
    },
    json(expression) {
      return JSON.parse(JSON.stringify(vm.runInContext(expression, context)));
    },
  };
}

module.exports = { createEngine };
