const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");

const APP_PATH = path.join(__dirname, "..", "app.js");
const INITIALIZATION = /\nbindEvents\(\);\nloadGame\(\);\nsyncSettingsUI\(\);\nrender\(\);\s*$/;

function createEngine() {
  const source = fs.readFileSync(APP_PATH, "utf8").replace(INITIALIZATION, "");
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
  vm.runInContext(source, context, { filename: APP_PATH });

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
