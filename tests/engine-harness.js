const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");

const ROOT = path.join(__dirname, "..");
const CONSTANTS_PATH = path.join(ROOT, "src", "constants.js");
const APP_PATH = path.join(ROOT, "app.js");
const INITIALIZATION = /\nbindEvents\(\);\nloadGame\(\);\nsyncSettingsUI\(\);\nrender\(\);\s*$/;

function createEngine() {
  const constantsSrc = fs.readFileSync(CONSTANTS_PATH, "utf8");
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
  // constants.js 必须先执行,把 const 标识符注入词法环境后,app.js 才能引用。
  vm.runInContext(constantsSrc, context, { filename: CONSTANTS_PATH });
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
